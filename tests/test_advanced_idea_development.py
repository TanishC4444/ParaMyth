import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from paramyth.pipeline import creative_studio, idea_development as ideas


class IdeaDevelopmentTests(unittest.TestCase):
    def details(self, text):
        return {d['id']: d for d in ideas.analyze(text)['details']}

    def output(self, slots):
        return {'suggestions': [{'id': slot['id'], 'detail': 'Use a cautious mapmaker who keeps her failing eyesight secret.', 'reason': 'Give her a concrete limitation.'} for slot in slots]}

    def test_analysis_is_deterministic_and_tracks_explicit_missing_fields(self):
        text = 'Characters: Mira\nCharacter details: TBD\nSetting: a city built on moving islands\nMotivation: recover her lost map\nStakes: ?'
        self.assertEqual(ideas.analyze(text), ideas.analyze(text))
        details = self.details(text)
        self.assertEqual(details['characters']['status'], 'provided')
        self.assertEqual(details['setting']['evidence'], ['Setting: a city built on moving islands'])
        self.assertEqual(details['character_details']['status'], 'needs_detail')
        self.assertEqual(details['stakes']['status'], 'needs_detail')
        self.assertEqual(details['structure']['status'], 'not_detected')

    def test_natural_language_evidence(self):
        details = self.details('Mira, a stubborn mapmaker, wants to recover a map in a floating city, but a rival steals it. She risks losing her home.')
        for key in ('characters','character_details','motivation','setting','conflict','stakes'):
            self.assertEqual(details[key]['status'], 'provided', key)

    def test_help_is_not_provided_detail_and_only_exact_help_line_can_replace(self):
        text = 'Mira is a mapmaker.\n- help with adding an expansive setting\nShe must keep her promise.'
        state = ideas.analyze(text)
        slots = ideas.targets(state)
        self.assertEqual(slots[0]['quote'], '- help with adding an expansive setting')
        self.assertEqual(slots[0]['action'], 'replace_help')
        self.assertNotEqual(self.details(text)['setting']['status'], 'provided')
        self.assertTrue(all(s['action']=='append' for s in slots[1:]))

    def test_story_character_help_does_not_authorize_replacement(self):
        state = ideas.analyze('The girl asks for help with the setting of a trap.\nA sailor helps develop the island.')
        self.assertTrue(all(s['action']=='append' for s in ideas.targets(state)))

    def test_same_help_line_is_not_replaced_twice_for_multiple_topics(self):
        slots = ideas.targets(ideas.analyze('- help me develop characters and setting'))
        self.assertEqual(len([s for s in slots if s['action']=='replace_help']), 1)

    def test_ordinary_details_remain_append_only_even_if_model_supplies_quote(self):
        text = 'Characters: Mira\nSetting: a lighthouse\n'
        state = ideas.analyze(text); slots = ideas.targets(state)
        output = self.output(slots)
        output.update(text='It was a dark and stormy night.', completed_brief={'premise':'Changed story'})
        for row in output['suggestions']: row.update(quote=text, action='replace_help')
        result = ideas.result(text,state,slots,output)
        self.assertEqual(result['text'], text)
        self.assertNotIn('completed_brief', result)
        self.assertTrue(all(s['action']=='append' and not s['quote'] for s in result['suggestions']))

    def test_supplied_details_are_not_suggested_as_missing(self):
        state = ideas.analyze('Characters: Mira\nCharacter details: cautious cartographer\nMotivation: recover her map\nSetting: Lisbon\nConflict: a rival blocks her\nStakes: lose her home\nTone: quiet\nStructure: chronological')
        slots=ideas.targets(state)
        self.assertTrue(slots)
        self.assertFalse({s["aspect_id"] for s in slots} & {d["id"] for d in state["details"] if d["status"]=="provided"})

    def test_use_idea_disables_unsolicited_suggestions_but_honors_help(self):
        self.assertEqual(ideas.targets(ideas.analyze('A story'),False), [])
        slots = ideas.targets(ideas.analyze('A story\n- brainstorm a setting'),False)
        self.assertEqual(len(slots),1)
        self.assertEqual(slots[0]['action'],'replace_help')

    def test_structure_preference_counts_as_supplied(self):
        slots=ideas.targets(ideas.analyze('', 'Two alternating timelines'))
        self.assertNotIn('structure',[s['id'] for s in slots])

    def test_invalid_or_story_sized_proposals_fail_instead_of_becoming_prompt(self):
        state=ideas.analyze('');slots=ideas.targets(state)
        for change in ('wrong_id','duplicate','paragraph','long'):
            output=self.output(slots)
            if change=='wrong_id':output['suggestions'][0]['id']='other'
            elif change=='duplicate':output['suggestions'][1]['id']=output['suggestions'][0]['id']
            elif change=='paragraph':output['suggestions'][0]['detail']='First paragraph.\n\nSecond paragraph.'
            else:output['suggestions'][0]['detail']='story '*100
            with self.subTest(change=change), self.assertRaises(ValueError):ideas.result('',state,slots,output)

    def test_streaming_ideas_never_publish_model_story_text_and_skip_prose_review_loop(self):
        text='Mira is a mapmaker.\n- help with adding an expansive setting'
        previews=[]
        def complete(provider,model,messages,temperature,chunk,**kwargs):
            data=json.loads(messages[-1]['content'])
            self.assertEqual(data['author_prompt'],text)
            output=self.output(data['requested_slots']);output['text']='UNWANTED STORY OPENING'
            raw=json.dumps(output);chunk(raw)
            return {'choices':[{'finish_reason':'stop','message':{'content':raw}}]}
        with tempfile.TemporaryDirectory() as temp, patch.object(creative_studio.creative_stream,'configuration',return_value=('test','test')), patch.object(creative_studio.creative_stream,'completion',side_effect=complete) as call:
            result=creative_studio.run(Path(temp), {'operation':'loop','loop_mode':'ideas','idea_text':text,'brief':'Reference material','use_story':False}, lambda message,**kw:previews.append(kw.get('preview')),stream=True)
        self.assertEqual(call.call_count,1)
        self.assertEqual(result['result']['text'],text)
        self.assertNotIn('UNWANTED',json.dumps([result,previews]))
        self.assertTrue(result['result']['prompt_only'])

    def test_separate_advice_requests_target_existing_details_without_replacing_them(self):
        text='Characters: Mara and Eli\nSetting: a lighthouse'
        state=ideas.analyze(text)
        slots=ideas.targets(state,True,'Suggest a different setting')
        self.assertEqual([s['aspect_id'] for s in slots],['setting'])
        self.assertEqual(slots[0]['action'],'append')
        result=ideas.result(text,state,slots,self.output(slots))
        self.assertEqual(result['text'],text)
        self.assertEqual(result['suggestions'][0]['quote'],'')

    def test_general_advice_is_an_optional_addition_and_never_part_of_original_prompt(self):
        slots=ideas.targets(ideas.analyze('A keeper finds a chart'),True,'How can I make this more surprising?')
        self.assertEqual([s['id'] for s in slots],['advice_idea'])
        self.assertEqual(slots[0]['action'],'append')

    def test_accepted_label_is_detected_on_next_analysis(self):
        for key,label,_,_ in ideas.RULES:
            self.assertEqual(self.details(f'{label}: Use a concrete author choice.')[key]['status'],'provided',key)


if __name__ == '__main__': unittest.main()
