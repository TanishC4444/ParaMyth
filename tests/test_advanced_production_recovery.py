from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from paramyth.pipeline import production
from paramyth.pipeline.production_research import ProviderError
from tests.test_production import breakdown


class ProductionRecoveryTests(unittest.TestCase):
    def test_repairs_bad_text_lists_without_repeating_breakdown_or_search(self):
        malformed={'summary':'Plan','next_steps':[{'owner':'Producer','task':'Scout coast'}]}
        valid={'summary':'Plan','next_steps':['Producer: scout the coast and prepare a shortlist.']}
        model=Mock();model.ask.side_effect=[breakdown(),malformed,valid]
        model.calls=[];model.provider='test';model.model='test'
        with tempfile.TemporaryDirectory() as temp, patch.object(production,'Muse',return_value=model), patch.object(production,'Search') as search:
            plan=production.create_plan(Path(temp),{'search_limit':0},sources=[{'file':'chapter','text':'A lighthouse keeper finds a lost map.'}])
        self.assertEqual(model.ask.call_count,3)
        self.assertEqual(plan['recommendations']['next_steps'],valid['next_steps'])
        self.assertIn('next_steps',model.ask.call_args.args[0])
        search.return_value.search.assert_not_called()

    def test_repairs_invalid_breakdown_before_scheduling(self):
        invalid=deepcopy(breakdown());invalid['scenes'][0]['cast']='Mara'
        model=Mock();model.ask.side_effect=[invalid,breakdown()]
        value=production.ask_validated(model,production.BREAKDOWN_PROMPT,{},production.validate_breakdown)
        self.assertEqual(model.ask.call_count,2)
        self.assertIsInstance(value['scenes'][0]['cast'],list)

    def test_invalid_evidence_never_bypasses_validation_and_retries_are_bounded(self):
        model=Mock();model.ask.return_value={'locations':[{'name':'Unverified venue','source_ids':['UNKNOWN']}]}
        with self.assertRaisesRegex(ProviderError,'3 attempts'):
            production.ask_validated(model,'',{},lambda v:production.validate_recommendations(v,[]))
        self.assertEqual(model.ask.call_count,3)

    def test_provider_credentials_failure_is_not_retried(self):
        model=Mock();model.ask.side_effect=ProviderError('Provider HTTP 401')
        with self.assertRaises(ProviderError):production.ask_validated(model,'',{},production.validate_breakdown)
        self.assertEqual(model.ask.call_count,1)
