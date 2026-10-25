import io
import json
import unittest
from unittest.mock import patch
from paramyth.pipeline.rag.rerank import rerank
from paramyth.pipeline.retrieval import retrieve

class AtlasRelevanceTests(unittest.TestCase):
    sources=[{'id':'real-one','title':'First work','summary':'A voyage home.'},{'id':'real-two','title':'Second work','summary':'A long absence.'}]
    def response(self,matches):
        return io.BytesIO(json.dumps({'candidates':[{'content':{'parts':[{'text':json.dumps({'matches':matches})}]}}]}).encode())
    def test_ranked_results_keep_corpus_records_and_explain_relevance(self):
        matches=[{'id':'real-two','reason':'A related long absence.','kind':'related'},{'id':'real-one','reason':'A voyage home.','kind':'direct'}]
        with patch('paramyth.pipeline.rag.rerank.api_key',return_value='test-key'),patch('urllib.request.urlopen',return_value=self.response(matches)) as request:
            result=rerank('homecoming',self.sources,2)
        self.assertEqual([s['id'] for s in result],['real-two','real-one'])
        self.assertEqual(result[0]['title'],'Second work')
        self.assertEqual(result[0]['match_reason'],'A related long absence.')
        self.assertNotIn('test-key',request.call_args.args[0].full_url)
    def test_unknown_duplicate_and_excess_matches_are_rejected(self):
        valid={'id':'real-one','reason':'A voyage home.','kind':'direct'}
        for matches in ([{**valid,'id':'invented'}],[valid,valid],[valid,{**valid,'id':'real-two'},valid]):
            with patch('paramyth.pipeline.rag.rerank.api_key',return_value='test-key'),patch('urllib.request.urlopen',return_value=self.response(matches)):
                with self.assertRaisesRegex(RuntimeError,'unavailable'):rerank('homecoming',self.sources,2)
    def test_fewer_matches_are_allowed_instead_of_filling_with_irrelevant_stories(self):
        with patch('paramyth.pipeline.rag.rerank.api_key',return_value='test-key'),patch('urllib.request.urlopen',return_value=self.response([])):
            self.assertEqual(rerank('unrelated',self.sources,8),[])
    def test_existing_writer_packet_keeps_its_source_limit(self):
        result=retrieve({'premise':'a bargain at sea','retrieval_query':'a bargain at sea','characters':[],'keywords':[],'retrieval_mode':'lexical','references':[]})
        self.assertEqual(len(result['sources']),3)

if __name__=='__main__':unittest.main()
