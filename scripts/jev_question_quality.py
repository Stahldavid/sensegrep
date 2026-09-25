"""Development-only question hygiene. Warnings are not semantic proof."""
import math
import re


def lint_question(question):
    text = question['instructions'].lower()
    rules = {
        'counting-or-arithmetic': r'\b(how many|count the|sum of|percentage|majority|more than \d|menos de \d|quantos|quantas)\b',
        'double-negation': r'\b(not|never|não)\b.{0,35}\b(not|never|não)\b',
        'unbounded-quantifier': r'\b(all|every|none|todos|nenhum)\b',
        'compound-judgment': r'\b(and|or|e|ou)\b',
        'ambiguous-reference': r'\b(this behavior|that operation|esse comportamento)\b',
    }
    return [name for name, pattern in rules.items() if re.search(pattern, text)]


def correlation(a, b):
    am, bm = sum(a)/len(a), sum(b)/len(b)
    denominator = math.sqrt(sum((v-am)**2 for v in a)*sum((v-bm)**2 for v in b))
    return sum((x-am)*(y-bm) for x,y in zip(a,b))/denominator if denominator else 0.


def screen_examples(dev, limit=6):
    groups = sorted({r['group'] for r in dev})
    buckets = [[r for r in dev if r['group']==group] for group in groups]
    selected=[]
    for offset in range(max(map(len,buckets))):
        for bucket in buckets:
            if offset<len(bucket): selected.append({k:bucket[offset][k] for k in ('query','candidate')})
            if len(selected)>=limit: return selected
    return selected


def redundant_columns(rows, newcols, existing, threshold=.98):
    """Report redundancy; CV still decides whether replacing/retaining a feature helps."""
    return {n: [old for old in existing if abs(correlation(
        [r['features'][n] for r in rows], [r['features'][old] for r in rows])) >= threshold]
        for n in newcols}


def feedback_examples(dev, names, cal, limit=8):
    # Out-of-fold predictions prevent training fit from hiding difficult examples.
    groups = sorted({r['group'] for r in dev})
    predictions = {}
    for offset in range(min(5, len(groups))):
        held = set(groups[offset::min(5,len(groups))])
        train = [r for r in dev if r['group'] not in held]
        indices = [i for i,r in enumerate(dev) if r['group'] in held]
        model = cal.train(train, names)
        predictions.update(zip(indices, cal.predict(model, [dev[i] for i in indices])))
    order = sorted(range(len(dev)), key=lambda i: abs(dev[i]['label']-predictions[i]), reverse=True)
    hard = order[:min(limit//2,len(order))]
    easy = [i for i in reversed(order) if i not in hard][:limit-len(hard)]
    return [{'query':dev[i]['query'], 'candidate':{**dev[i]['candidate'], 'content':dev[i]['candidate']['content'][:4000]},
             'label':dev[i]['label'], 'prediction':predictions[i], 'exampleKind':'error' if i in hard else 'correct',
             'features':{n:dev[i]['features'][n] for n in names}} for i in hard+easy]
