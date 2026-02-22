#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const REPORTS_DIR = path.join(ROOT_DIR, 'reports');
const SOAK_REPORT_PATH = path.join(REPORTS_DIR, 'bot-soak-1h.latest.json');
const NEXT_ACTIONS_PATH = path.join(REPORTS_DIR, 'bot-soak-1h.next-actions.json');
const ADAPTIVE_PROFILE_PATH = path.join(REPORTS_DIR, 'bot-soak-1h.adaptive-profile.json');
const EVOLUTION_JSON_PATH = path.join(REPORTS_DIR, 'bot-evolution-cycle.latest.json');
const EVOLUTION_MD_PATH = path.join(REPORTS_DIR, 'bot-evolution-cycle.latest.md');

const isForceByArg = process.argv.includes('--force');
const MODE = (process.env.EVOLVE_MODE || (isForceByArg ? 'force' : 'auto')).toLowerCase();
const RUN_SOAK = process.env.EVOLVE_RUN_SOAK !== 'false';
const RUN_RELIABILITY = process.env.EVOLVE_RUN_RELIABILITY !== 'false';
const RUN_AUDIO = process.env.EVOLVE_RUN_AUDIO !== 'false';
const RUN_QUICK_VERIFY = process.env.EVOLVE_RUN_QUICK !== 'false';
const QUICK_SCALE = String(process.env.EVOLVE_QUICK_SCALE || '0.08');

function nowIso() {
  return new Date().toISOString();
}

function ensureReportsDir() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

function readJson(filePath, fallbackValue) {
  try {
    if (!fs.existsSync(filePath)) return fallbackValue;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallbackValue;
  }
}

function writeJson(filePath, value) {
  ensureReportsDir();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round2(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function runCommand(stepName, command, args, envPatch = {}) {
  const startedAt = Date.now();
  console.log(`\n=== ${stepName} ===`);
  console.log(`$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...envPatch,
    },
  });
  const durationMs = Date.now() - startedAt;
  return {
    step: stepName,
    command: `${command} ${args.join(' ')}`,
    exitCode: Number.isInteger(result.status) ? result.status : -1,
    signal: result.signal || null,
    durationMs,
    ok: result.status === 0,
  };
}

function summarizeSoak(report) {
  if (!report || typeof report !== 'object') return null;
  const total = report.total || {};
  const diag = report.diagnostic || {};
  return {
    generatedAt: report.generatedAt || null,
    score: Number(diag.score || 0),
    grade: diag.grade || 'N/A',
    adjustedEventFailureRatePercent: Number(total.adjustedEventFailureRatePercent || 0),
    retryRatioPercent: Number(total.retryRatioPercent || 0),
    audioFailureRatePercent: Number(diag.metrics?.audioFailurePercent || 0),
    p95Ms: Number(total.latencyMs?.p95 || 0),
    throughputReqPerSec: Number(total.throughputReqPerSec || 0),
    eventsTotal: Number(total.eventsTotal || 0),
    eventsFailedNonChaos: Number(total.eventsFailedNonChaos || 0),
  };
}

function hasPriorityArea(nextActions, area) {
  const priorities = Array.isArray(nextActions?.priorities) ? nextActions.priorities : [];
  return priorities.some(item => String(item?.area || '').toLowerCase() === area);
}

function applyForceAdjustments(profile, nextActions) {
  const updated = JSON.parse(JSON.stringify(profile || {}));
  const phaseAdjustments = updated.phaseAdjustments || {};
  const targetPhases = ['raras', 'desubicados', 'acero'];

  const boostAudio = hasPriorityArea(nextActions, 'audio');
  const boostResilience = hasPriorityArea(nextActions, 'resilience');
  const boostStability = hasPriorityArea(nextActions, 'stability');

  const changes = [];

  for (const phaseId of targetPhases) {
    const p = phaseAdjustments[phaseId];
    if (!p) continue;

    const before = { ...p };
    if (boostAudio) {
      p.audioRatioDelta = clamp(Number(p.audioRatioDelta || 0) + 0.02, -0.35, 0.35);
      p.nonDebugAudioChanceDelta = clamp(
        Number(p.nonDebugAudioChanceDelta || 0) + 0.02,
        -0.35,
        0.35
      );
    }
    if (boostResilience) {
      p.duplicateChanceDelta = clamp(Number(p.duplicateChanceDelta || 0) + 0.005, -0.2, 0.2);
      p.outOfOrderChanceDelta = clamp(Number(p.outOfOrderChanceDelta || 0) + 0.005, -0.2, 0.2);
    }
    if (boostStability) {
      p.weirdRatioDelta = clamp(Number(p.weirdRatioDelta || 0) + 0.01, -0.35, 0.35);
    }

    changes.push({
      phase: phaseId,
      before,
      after: { ...p },
    });
  }

  updated.updatedAt = nowIso();
  updated.notes =
    'Perfil ajustado en modo force por runBotEvolutionCycle.js. Solo afecta estres de pruebas.';
  return { updatedProfile: updated, changes };
}

function writeMarkdownReport(payload) {
  const lines = [
    '# Bot Evolution Cycle',
    '',
    `Generated: ${payload.generatedAt}`,
    `Mode: ${payload.mode}`,
    `Run soak: ${payload.config.runSoak}`,
    `Run reliability tests: ${payload.config.runReliability}`,
    `Run audio tests: ${payload.config.runAudio}`,
    `Run quick verify: ${payload.config.runQuickVerify}`,
    `Quick verify scale: ${payload.config.quickScale}`,
    '',
    '## Steps',
  ];

  for (const step of payload.steps) {
    lines.push(
      `- ${step.step}: ${step.ok ? 'OK' : 'FAIL'} (exit=${step.exitCode}, ${step.durationMs}ms)`
    );
  }

  lines.push('', '## Soak Summary Before');
  if (payload.soakBefore) {
    lines.push(`- Score: ${payload.soakBefore.score} (${payload.soakBefore.grade})`);
    lines.push(
      `- Adjusted event failure: ${payload.soakBefore.adjustedEventFailureRatePercent}%`
    );
    lines.push(`- Retry ratio: ${payload.soakBefore.retryRatioPercent}%`);
    lines.push(`- Audio failure: ${payload.soakBefore.audioFailureRatePercent}%`);
    lines.push(`- p95: ${payload.soakBefore.p95Ms}ms`);
  } else {
    lines.push('- Not available');
  }

  lines.push('', '## Soak Summary After Quick Verify');
  if (payload.soakAfterQuick) {
    lines.push(`- Score: ${payload.soakAfterQuick.score} (${payload.soakAfterQuick.grade})`);
    lines.push(
      `- Adjusted event failure: ${payload.soakAfterQuick.adjustedEventFailureRatePercent}%`
    );
    lines.push(`- Retry ratio: ${payload.soakAfterQuick.retryRatioPercent}%`);
    lines.push(`- Audio failure: ${payload.soakAfterQuick.audioFailureRatePercent}%`);
    lines.push(`- p95: ${payload.soakAfterQuick.p95Ms}ms`);
  } else {
    lines.push('- Not executed');
  }

  lines.push('', '## Force Adjustments');
  if (payload.forceAdjustments?.length) {
    for (const item of payload.forceAdjustments) {
      lines.push(`- ${item.phase}: adjusted`);
    }
  } else {
    lines.push('- None');
  }

  lines.push('', '## Decision');
  lines.push(`- Success: ${payload.success}`);
  lines.push(`- Recommendation: ${payload.recommendation}`);
  lines.push('', `JSON report: ${EVOLUTION_JSON_PATH}`);

  ensureReportsDir();
  fs.writeFileSync(EVOLUTION_MD_PATH, lines.join('\n'));
}

function main() {
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const steps = [];

  if (RUN_SOAK) {
    steps.push(runCommand('Soak 1h', 'node', ['scripts/runOneHourBotSoak.js']));
  }

  const soakBefore = summarizeSoak(readJson(SOAK_REPORT_PATH, null));
  const nextActions = readJson(NEXT_ACTIONS_PATH, { priorities: [] });
  let forceAdjustments = [];

  if (MODE === 'force') {
    const currentProfile = readJson(ADAPTIVE_PROFILE_PATH, null);
    if (currentProfile?.phaseAdjustments) {
      const { updatedProfile, changes } = applyForceAdjustments(currentProfile, nextActions);
      writeJson(ADAPTIVE_PROFILE_PATH, updatedProfile);
      forceAdjustments = changes;
      console.log(`Perfil adaptativo reforzado (${changes.length} fases ajustadas).`);
    } else {
      console.log('No se encontro perfil adaptativo para reforzar.');
    }
  }

  if (RUN_RELIABILITY) {
    steps.push(runCommand('Reliability tests', npmBin, ['run', 'test:reliability']));
  }
  if (RUN_AUDIO) {
    steps.push(runCommand('Audio tests', npmBin, ['run', 'test:audio']));
  }

  let soakAfterQuick = null;
  if (RUN_QUICK_VERIFY) {
    steps.push(
      runCommand('Quick soak verify', 'node', ['scripts/runOneHourBotSoak.js'], {
        SOAK_PHASE_SCALE: QUICK_SCALE,
      })
    );
    soakAfterQuick = summarizeSoak(readJson(SOAK_REPORT_PATH, null));
  }

  const failedSteps = steps.filter(step => !step.ok);
  const success = failedSteps.length === 0;
  const recommendation = success
    ? 'Ciclo completado. Seguir con otra corrida normal de 1h para consolidar tendencia.'
    : `Revisar pasos fallidos: ${failedSteps.map(step => step.step).join(', ')}`;

  const payload = {
    generatedAt: nowIso(),
    mode: MODE,
    config: {
      runSoak: RUN_SOAK,
      runReliability: RUN_RELIABILITY,
      runAudio: RUN_AUDIO,
      runQuickVerify: RUN_QUICK_VERIFY,
      quickScale: QUICK_SCALE,
    },
    soakBefore,
    soakAfterQuick,
    priorities: Array.isArray(nextActions.priorities) ? nextActions.priorities : [],
    forceAdjustments,
    steps,
    success,
    recommendation,
  };

  writeJson(EVOLUTION_JSON_PATH, payload);
  writeMarkdownReport(payload);

  console.log('\n=== Evolution cycle summary ===');
  console.log(JSON.stringify(payload, null, 2));
  console.log(`Evolution JSON: ${EVOLUTION_JSON_PATH}`);
  console.log(`Evolution MD: ${EVOLUTION_MD_PATH}`);

  if (!success) {
    process.exit(1);
  }
}

main();
