#!/usr/bin/env ts-node
/**
 * Analyze promptfoo results and generate final benchmark report
 *
 * Usage:
 *   ts-node 3-analyze-results.ts [path-to-results.json]
 *   ts-node 3-analyze-results.ts ../results/mvp.json
 */

import fs from 'fs';
import path from 'path';

interface PromptfooAssertion {
  type: string;
  pass: boolean;
  score: number;
  reason?: string;
}

interface PromptfooTestResult {
  provider: {
    id: string;
    label: string;
  };
  vars: {
    task_id: string;
    repo_name: string;
    ground_truth_file: string;
    ground_truth_symbol: string;
  };
  response: {
    output: string;
    metadata?: {
      toolUses?: any[];
    };
  };
  success: boolean;
  score: number;
  latencyMs: number;
  cost: number;
  gradingResult: {
    componentResults: PromptfooAssertion[];
  };
}

interface PromptfooOutput {
  results: PromptfooTestResult[];
  stats: {
    successes: number;
    failures: number;
    tokenUsage: {
      total: number;
      prompt: number;
      completion: number;
      cached: number;
    };
  };
}

interface ProviderStats {
  provider: string;
  taskCount: number;
  avgToolCalls: number;
  medianToolCalls: number;
  completionRate: number;
  avgCost: number;
  avgLatency: number;
  avgScore: number;
  toolCallDistribution: number[];
}

function extractToolCalls(result: PromptfooTestResult): number {
  // Try to extract from metadata
  if (result.response.metadata?.toolUses) {
    return result.response.metadata.toolUses.length;
  }

  // Fallback: extract from javascript assertion reason
  const jsAssertion = result.gradingResult.componentResults.find(
    (c) => c.type === 'javascript'
  );

  if (jsAssertion?.reason) {
    const match = jsAssertion.reason.match(/Tool calls: (\d+)/);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  return 0;
}

function calculateStats(results: PromptfooTestResult[]): ProviderStats {
  if (results.length === 0) {
    throw new Error('No results to analyze');
  }

  const provider = results[0].provider.label;
  const toolCalls = results.map(extractToolCalls);
  const sorted = [...toolCalls].sort((a, b) => a - b);

  // Completion: llm-rubric score >= 0.6
  const completed = results.filter((r) => {
    const rubric = r.gradingResult.componentResults.find(
      (c) => c.type === 'llm-rubric'
    );
    return rubric && rubric.score >= 0.6;
  });

  return {
    provider,
    taskCount: results.length,
    avgToolCalls: toolCalls.reduce((a, b) => a + b, 0) / toolCalls.length,
    medianToolCalls: sorted[Math.floor(sorted.length / 2)],
    completionRate: completed.length / results.length,
    avgCost: results.reduce((sum, r) => sum + r.cost, 0) / results.length,
    avgLatency: results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length,
    avgScore: results.reduce((sum, r) => sum + r.score, 0) / results.length,
    toolCallDistribution: sorted,
  };
}

function main() {
  const args = process.argv.slice(2);
  const resultsPath =
    args[0] || path.join(__dirname, '..', 'results', 'latest.json');

  console.log(`📊 Analyzing promptfoo results from: ${resultsPath}\n`);

  if (!fs.existsSync(resultsPath)) {
    console.error(`❌ Error: Results file not found: ${resultsPath}`);
    process.exit(1);
  }

  const data: PromptfooOutput = JSON.parse(
    fs.readFileSync(resultsPath, 'utf-8')
  );

  console.log(`Total results: ${data.results.length}`);
  console.log(`Successes: ${data.stats.successes}`);
  console.log(`Failures: ${data.stats.failures}\n`);

  // Group by provider
  const byProvider: Record<string, PromptfooTestResult[]> = {};
  for (const result of data.results) {
    const label = result.provider.label;
    if (!byProvider[label]) {
      byProvider[label] = [];
    }
    byProvider[label].push(result);
  }

  console.log('='.repeat(70));
  console.log('📈 BENCHMARK RESULTS');
  console.log('='.repeat(70));
  console.log('');

  const allStats: ProviderStats[] = [];

  for (const [providerLabel, results] of Object.entries(byProvider)) {
    const stats = calculateStats(results);
    allStats.push(stats);

    console.log(`${providerLabel}:`);
    console.log(`  Tasks:             ${stats.taskCount}`);
    console.log(`  Avg tool calls:    ${stats.avgToolCalls.toFixed(1)}`);
    console.log(`  Median tool calls: ${stats.medianToolCalls}`);
    console.log(`  Completion rate:   ${(stats.completionRate * 100).toFixed(1)}%`);
    console.log(`  Avg cost:          $${stats.avgCost.toFixed(3)}`);
    console.log(`  Avg latency:       ${(stats.avgLatency / 1000).toFixed(1)}s`);
    console.log(`  Avg score:         ${stats.avgScore.toFixed(2)}`);
    console.log('');
  }

  // Calculate improvements
  const grepStats = allStats.find((s) => s.provider === 'grep-only');
  const sensegrepStats = allStats.find((s) => s.provider === 'sensegrep-only');

  if (grepStats && sensegrepStats) {
    console.log('='.repeat(70));
    console.log('🎯 IMPROVEMENTS (sensegrep vs grep)');
    console.log('='.repeat(70));
    console.log('');

    const toolCallReduction =
      grepStats.avgToolCalls / sensegrepStats.avgToolCalls;
    const completionImprovement =
      sensegrepStats.completionRate - grepStats.completionRate;
    const costReduction = 1 - sensegrepStats.avgCost / grepStats.avgCost;

    console.log(`Tool calls:     ${toolCallReduction.toFixed(2)}x fewer`);
    console.log(
      `Completion:     ${completionImprovement > 0 ? '+' : ''}${(completionImprovement * 100).toFixed(1)}pp`
    );
    console.log(
      `Cost:           ${(costReduction * 100).toFixed(1)}% reduction`
    );
    console.log('');

    // Success criteria check
    console.log('='.repeat(70));
    console.log('✅ SUCCESS CRITERIA');
    console.log('='.repeat(70));
    console.log('');

    const checks = [
      {
        name: 'Tool call reduction ≥2x',
        pass: toolCallReduction >= 2.0,
        value: `${toolCallReduction.toFixed(2)}x`,
      },
      {
        name: 'Completion improvement ≥15pp',
        pass: completionImprovement >= 0.15,
        value: `${(completionImprovement * 100).toFixed(1)}pp`,
      },
      {
        name: 'Cost reduction (any)',
        pass: costReduction > 0,
        value: `${(costReduction * 100).toFixed(1)}%`,
      },
    ];

    for (const check of checks) {
      const icon = check.pass ? '✅' : '❌';
      console.log(`${icon} ${check.name}: ${check.value}`);
    }

    console.log('');

    const overallPass = checks.every((c) => c.pass);
    if (overallPass) {
      console.log('🎉 ALL SUCCESS CRITERIA MET!');
      console.log('Recommendation: Proceed to full MVP (50 tasks)');
    } else {
      console.log('⚠️  Some criteria not met.');
      console.log('Recommendation: Investigate and iterate before scaling.');
    }
  }

  console.log('');
  console.log('='.repeat(70));
}

main();
