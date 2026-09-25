import copy
import importlib.util
import unittest
from pathlib import Path
import jev_calibration as calibration

spec=importlib.util.spec_from_file_location('research',Path(__file__).with_name('autoresearch-jev.py'))
research=importlib.util.module_from_spec(spec);spec.loader.exec_module(research)

class ResearchTests(unittest.TestCase):
    def test_screen_rejects_before_full_featurization(self):
        def forbidden(*args): raise AssertionError('Rejected question must not be featurized')
        result=research.discover(self.rows(),lambda *a:{'count':{'type':'noul','instructions':'How many calls implement all rules?'}},forbidden,
            screen=lambda *a:{'answerable':.1,'atomic':.9,'applicable':.9,'variable':.9})
        self.assertFalse(result['questions'])
        self.assertIn('counting-or-arithmetic',result['history'][0]['lint'])
        self.assertTrue(result['screeningEnabled'])

    def test_feedback_uses_both_error_and_correct_dev_examples(self):
        from jev_question_quality import feedback_examples, redundant_columns, screen_examples
        rows=self.rows()[:32]
        examples=feedback_examples(rows,['localScore'],research.cal)
        self.assertEqual({e['exampleKind'] for e in examples},{'error','correct'})
        self.assertEqual(len(examples),8)
        for i,r in enumerate(rows): r['features'].update(a=i,b=-i)
        self.assertEqual(redundant_columns(rows,['b'],['a']),{'b':['a']})
        for r in rows:r['query']=r['group']
        screened=screen_examples(rows)
        self.assertEqual(len({r['query'] for r in screened}),4)
        self.assertTrue(all(set(r)=={'query','candidate'} for r in screened))

    def rows(self):
        return [{'group':f'g{g}','split':'test' if g==4 else 'dev','label':i%2,'query':'requested rule',
                 'candidate':{'content':'implements' if i%2 else 'unrelated'},'features':{'localScore':.5}}
                for g in range(5) for i in range(8)]

    def test_discovers_signal_without_exposing_labels_to_feature_model(self):
        seen=[]
        def propose(i,accepted,dev):
            self.assertTrue(all(r['split']=='dev' for r in dev));seen.append(i)
            return {'direct':{'type':'noul','instructions':'Does candidate implement query?'}}
        def feature(rows,questions):
            self.assertTrue(all(set(r)=={'query','candidate'} for r in rows))
            return [{'direct':float(r['candidate']['content']=='implements')} for r in rows]
        result=research.discover(self.rows(),propose,feature)
        self.assertIn('direct',result['questions']);self.assertFalse(result['deploy'])
        self.assertLess(result['test']['selected']['brier'],result['test']['baseline']['brier'])
        rows=self.rows()
        for r in rows:
            if r['split']=='test':r['label']=1-r['label']
        changed=research.discover(rows,propose,feature)
        self.assertEqual(result['history'],changed['history']);self.assertEqual(result['model'],changed['model'])

    def test_rejects_bad_questions_and_leaking_groups(self):
        with self.assertRaises(ValueError):research.validate_questions({'bad':{'type':'score','instructions':'x','criteria':['one']}})
        rows=self.rows();rows[-1]['group']='g0'
        with self.assertRaises(ValueError):research.discover(rows,lambda *a:{},lambda *a:[])

    def test_calibration_ties_and_exact_contract(self):
        contract={'modelRequested':'jev','modelObserved':'jev-1.13.0','questions':{'q':'specific rule'},'evidenceFields':['query','source'],
                  'panel':'noul','batchSize':1,'version':'v4','languagePolicy':'pt-en'}
        h=calibration.contract_hash(contract)
        rows=[{'group':f'g{g}','split':'validation' if g==4 else 'train','label':i%2,'score':.3 if i%2==0 else .7,
               'contractHash':h,'labelSource':'synthetic-test'} for g in range(5) for i in range(8)]
        result=calibration.fit(rows,contract,min_train=10,min_validation=4)
        self.assertTrue(result['improved']);self.assertEqual(calibration.apply_artifact(result,[.3,.7],contract),[0,1])
        for field in contract:
            altered=copy.deepcopy(contract);altered[field]='changed'
            with self.assertRaises(ValueError):calibration.apply_artifact(result,[.5],altered)
        changed=copy.deepcopy(rows)
        for r in changed:
            if r['split']=='validation':r['label']=1-r['label']
        self.assertEqual(result['knots'],calibration.fit(changed,contract,10,4)['knots'])
        changed[-1]['group']='g0'
        with self.assertRaises(ValueError):calibration.fit(changed,contract,10,4)

if __name__=='__main__':unittest.main()
