import copy
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('context',Path(__file__).with_name('autoresearch-jev-context.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


def episode(group):
    rows=[]
    for name,label in [('a',0),('b',1),('c',1),('d',None)]:
        rows.append({'id':group+name,'key':group+name,'label':label,'group':group,'tokens':100,'complete':True,
            'features':{'localScore':.5},'candidate':{'file':name+'.ts','startLine':1,'endLine':3,
             'content':'required' if label==1 else 'other','metadata':{'symbolName':name}}})
    baseline=[{k:r[k] for k in ('id','key','tokens','complete')} for r in rows[:2]]
    return {'id':group,'group':group,'split':'dev','query':'requested operation and helper','budget':200,'limit':2,
        'required':[{'key':group+'b','role':'rule'},{'key':group+'c','role':'helper'}],'candidates':rows,
        'baseline':{'local':baseline,'current':baseline},'trace':{k:[r['key'] for r in rows] for k in ('retrieved','evaluated','diversified')}}


class ContextResearchTests(unittest.TestCase):
    def test_manual_proposals_are_validated_without_a_proposer_model(self):
        rounds=m.load_proposals(Path(__file__).parent/'fixtures/jev-manual-features.json')
        self.assertEqual(len(rounds),1)
        self.assertEqual(set(rounds[0]),{'requested_implementation','resolved_support','additional_rule'})
        for q in rounds[0].values():self.assertEqual(q['type'],'noul')

    def test_measurement_pool_filter_never_uses_gold_or_truncates_source(self):
        spec=importlib.util.spec_from_file_location('prepare',Path(__file__).with_name('prepare-jev-context-measurement.py'))
        prepare=importlib.util.module_from_spec(spec);spec.loader.exec_module(prepare)
        e=episode('g');e['candidates'][1]['candidate']['content']='x'*100
        result=prepare.prepare({'episodes':[copy.deepcopy(e)]},50)
        self.assertEqual(result['measurementFilter']['excluded'],1)
        self.assertEqual(result['episodes'][0]['required'],e['required'])
        self.assertNotIn('gb',[r['id'] for r in result['episodes'][0]['candidates']])
        with self.assertRaises(ValueError):prepare.prepare({'episodes':[e]},24001)

    def test_context_state_is_label_blind_and_excludes_candidate(self):
        e=episode('g');r=e['candidates'][0]
        state=m.feature_state(e,r,True)
        self.assertNotIn(r['candidate'],state['selected'])
        altered=copy.deepcopy(e);altered['required']=[]
        for row in altered['candidates']:row['label']=1
        self.assertEqual(state,m.feature_state(altered,altered['candidates'][0],True))
        self.assertEqual(set(state),{'query','candidate','selected'})

    def test_full_distributions_replay_the_frozen_encoding(self):
        q={'type':'score','instructions':'Contribution','criteria':['none','partial','direct']}
        self.assertEqual(m.columns('support',q,'distribution'),['support_p0','support_p1','support_p2'])
        artifact={'questions':{'support':q},'featureContracts':{'support':{'support':q}},'encoding':'distribution'}
        rows=m.frozen_features([{}],artifact,lambda rows,questions:[{'support_p0':.1,'support_p1':.2,'support_p2':.7}])
        self.assertEqual(rows,[{'support_p0':.1,'support_p1':.2,'support_p2':.7}])

    def test_unknown_candidates_are_never_negative_training_rows(self):
        e=episode('g');self.assertEqual(len(m.training_rows([e])),3)
        selected=m.selected_packet(e,[0,0,0,1])
        self.assertEqual(m.episode_metrics(e,selected)['unknownFraction'],.5)

    def test_budget_overlap_and_partial_source_are_enforced_without_labels(self):
        e=episode('g');e['candidates'][0]['complete']=False
        e['candidates'][2]['candidate']['file']='b.ts'
        selected=m.selected_packet(e,[1,.9,.8,.7])
        self.assertEqual([r['id'] for r in selected],['gb','gd'])
        altered=copy.deepcopy(e);altered['required']=[]
        for r in altered['candidates']:r['label']=0
        self.assertEqual([r['id'] for r in m.selected_packet(altered,[1,.9,.8,.7])],['gb','gd'])
        self.assertLessEqual(sum(r['tokens'] for r in selected),e['budget'])

    def test_missing_gold_is_retrieval_failure_not_injected(self):
        e=episode('g');e['required'].append({'key':'absent','role':'helper'})
        self.assertEqual(m.diagnose([e])[-1]['stage'],'retrieval')
        self.assertLess(m.episode_metrics(e,m.selected_packet(e,[0,1,1,0]))['requiredRecall'],1)

    def test_paraphrases_stay_together_in_cross_validation(self):
        episodes=[episode(g) for g in ('one','two','three')]
        duplicate=copy.deepcopy(episodes[0]);duplicate['id']='paraphrase';episodes.append(duplicate)
        def fit(rows,names):return {'seen':{r['group'] for r in rows}}
        def predict(model,rows):
            self.assertFalse(model['seen']&{r['group'] for r in rows})
            return [.5]*len(rows)
        with patch.object(m.cal,'train',fit),patch.object(m.cal,'predict',predict):m.cross_validate(episodes,['localScore'])

    def test_discovery_accepts_context_improvement_and_only_source_reaches_features(self):
        episodes=[episode(g) for g in ('one','two','three')]
        def propose(i,accepted,examples):
            self.assertTrue(all('contextMissingRequirements' in e for e in examples))
            return {'implements':{'type':'noul','instructions':'Does candidate implement the requested operation?'}} if i==0 else {}
        def features(rows,questions):
            self.assertTrue(all(set(r)=={'query','candidate'} for r in rows))
            return [{'implements':float(r['candidate']['content']=='required')} for r in rows]
        result=m.discover(episodes,propose,features,lambda q,e:dict.fromkeys(['answerable','atomic','applicable','variable'],1),2)
        self.assertIn('implements',result['questions'])
        self.assertEqual(result['dev']['selected']['metrics']['allRequired'],1)
        self.assertFalse(result['deploy'])

    def test_mixed_holdout_file_is_rejected(self):
        e=episode('g');e['split']='test'
        with self.assertRaises(ValueError):m.validate({'episodes':[episode('dev'),e]},'dev')

    def test_uncertain_screen_uses_dev_pilot_instead_of_discarding_useful_feature(self):
        episodes=[episode(g) for g in ('one','two','three')]
        calls=[]
        def features(rows,questions):
            calls.append(len(rows))
            return [{'implements':float(r['candidate']['content']=='required')} for r in rows]
        result=m.discover(episodes,lambda i,a,e: {'implements':{'type':'noul','instructions':'Does candidate implement the requested operation?'}},
            features,lambda q,e:dict.fromkeys(['answerable','atomic','applicable','variable'],.55),1)
        self.assertEqual(calls,[9,12])
        self.assertIn('implements',result['questions'])
        self.assertTrue(next(h for h in result['history'] if h['action']=='pilot')['proceed'])

    def test_constant_pilot_and_clear_screen_failure_skip_full_extraction(self):
        episodes=[episode(g) for g in ('one','two','three')]
        for confidence,expected_calls in ((.55,[9]),(.1,[])):
            calls=[]
            def features(rows,questions):
                calls.append(len(rows));return [{'constant':.5} for r in rows]
            result=m.discover(episodes,lambda i,a,e:{'constant':{'type':'noul','instructions':'Does candidate implement the requested operation?'}},
                features,lambda q,e:dict.fromkeys(['answerable','atomic','applicable','variable'],confidence),1)
            self.assertEqual(calls,expected_calls)
            self.assertFalse(result['questions'])

    def test_holdout_must_match_frozen_contract_and_have_disjoint_groups(self):
        episodes=[episode('new')]
        artifact={'developmentGroups':['old'],'policy':m.POLICY,'snapshot':'frozen','baseFeatures':['localScore'],'questions':{},'featureContracts':{}}
        m.validate_holdout(artifact,{'snapshot':'frozen'},episodes)
        with self.assertRaises(ValueError):m.validate_holdout(artifact,{'snapshot':'different'},episodes)
        with self.assertRaises(ValueError):m.validate_holdout(artifact,{'snapshot':'frozen'},[episode('old')])
        episodes[0]['candidates'][0]['features']['unexpected']=1
        with self.assertRaises(ValueError):m.validate_holdout(artifact,{'snapshot':'frozen'},episodes)

    def test_frozen_extraction_replays_companion_questions_but_keeps_only_selected_columns(self):
        selected={'type':'noul','instructions':'Selected question'}
        companion={'type':'noul','instructions':'Rejected companion question'}
        batch={'companion':companion,'selected':selected}
        artifact={'questions':{'selected':selected},'featureContracts':{'selected':batch}}
        def features(rows,questions):
            self.assertEqual(list(questions),['companion','selected'])
            self.assertEqual(questions,batch)
            return [{'companion':.1,'selected':.9} for _ in rows]
        self.assertEqual(m.frozen_features([{}],artifact,features),[{'selected':.9}])

    def test_seed_features_are_remeasured_and_revalidated_on_new_pool(self):
        episodes=[episode(g) for g in ('one','two','three')]
        question={'implements':{'type':'noul','instructions':'Does candidate implement the requested operation?'}}
        def features(rows,questions):return [{'implements':float(r['candidate']['content']=='required')} for r in rows]
        seed=m.discover(episodes,lambda *a:question,features,lambda *a:dict.fromkeys(['answerable','atomic','applicable','variable'],1),1)
        result=m.discover(episodes,lambda *a:{},features,lambda *a:self.fail('No screening needed for frozen seed'),1,seed)
        self.assertEqual(result['history'][0]['action'],'seed')
        self.assertTrue(result['history'][0]['accepted'])
        self.assertEqual(result['seedControl']['metrics']['allRequired'],1)
        self.assertEqual(result['dev']['selected']['metrics']['allRequired'],1)

    def test_cross_validation_can_keep_local_order_when_fitted_model_is_worse(self):
        episodes=[episode(g) for g in ('one','two','three')]
        for e in episodes:
            for row,score in zip(e['candidates'],[.1,.9,.8,.05]):row['features']['localScore']=score
        with patch.object(m.cal,'predict',lambda model,rows:[1-r['features']['localScore'] for r in rows]):
            result=m.cross_validate(episodes,['localScore'])
        self.assertEqual(result['learnedWeight'],0)
        self.assertEqual(result['metrics']['allRequired'],1)

    def test_small_direct_callee_can_replace_tail_without_reading_gold(self):
        e=episode('g');e['candidates'][1]['dependencies']=['gc']
        selected=m.selected_packet(e,[.6,.9,.1,.8])
        self.assertEqual([r['id'] for r in selected],['gb','gc'])
        for r in e['candidates']:r['label']=None
        e['required']=[]
        self.assertEqual([r['id'] for r in m.selected_packet(e,[.6,.9,.1,.8])],['gb','gc'])
        e['candidates'][2]['tokens']=201
        self.assertEqual([r['id'] for r in m.selected_packet(e,[.6,.9,.1,.8])],['gb','gd'])

    def test_failed_preservation_gate_blocks_test_before_feature_calls(self):
        with self.assertRaisesRegex(ValueError,'preservation gate'):
            m.validate_holdout({'preservationGate':{'passed':False}}, {}, [])


if __name__=='__main__':unittest.main()
