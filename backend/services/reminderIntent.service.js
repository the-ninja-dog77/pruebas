function normalizeText(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  const normalized = normalizeText(text);
  return normalized ? normalized.split(' ') : [];
}

function buildLexicon() {
  const confirmPrefixes = [
    '',
    'si',
    'ok',
    'dale',
    'de una',
    'listo',
    'perfecto',
    'genial',
    'buenisimo',
    'joya',
    'claro',
    'confirmado',
  ];
  const confirmSubjects = [
    '',
    'yo',
    'yo si',
    'si yo',
    'ahi',
    'ahi yo',
    'te',
    'nos',
  ];
  const confirmActions = [
    'voy',
    'voy a ir',
    'asisto',
    'asistire',
    'llego',
    'llego puntual',
    'confirmo',
    'confirmado',
    'presente',
    'estare',
    'cuento con eso',
    'me presento',
  ];
  const confirmTails = [
    '',
    'sin falta',
    'de una',
    'tranqui',
    'si rey',
    'si bro',
    'ahi nos vemos',
    'ya estoy saliendo',
    'todo bien',
    'nos vemos',
    'voy seguro',
  ];

  const cancelPrefixes = [
    '',
    'no',
    'disculpa',
    'perdon',
    'che',
    'bro',
    'rey',
    'al final',
    'mejor',
    'creo que',
    'la verdad',
    'lamentablemente',
  ];
  const cancelSubjects = [
    '',
    'yo',
    'yo no',
    'esta vez',
    'hoy',
    'al final yo',
    'no yo',
    'al final',
  ];
  const cancelActions = [
    'no voy',
    'no voy a poder',
    'no puedo',
    'no podre',
    'no llego',
    'no llegare',
    'no asisto',
    'no asistire',
    'cancelar',
    'cancelo',
    'anular',
    'reprogramar',
    'pasar para otro dia',
  ];
  const cancelTails = [
    '',
    'hoy no llego',
    'se me complico',
    'se me complica',
    'mejor otro dia',
    'otra fecha',
    'imposible hoy',
    'perdon',
    'se me cruzo algo',
    'tuve un problema',
    'no me da el tiempo',
  ];

  const buildCombinations = ({
    prefixes,
    subjects,
    actions,
    tails,
    maxSize = 6000,
  }) => {
    const set = new Set();
    for (const p of prefixes) {
      for (const s of subjects) {
        for (const a of actions) {
          for (const t of tails) {
            const phrase = `${p} ${s} ${a} ${t}`.replace(/\s+/g, ' ').trim();
            if (phrase.length < 2) continue;
            set.add(phrase);
            if (set.size >= maxSize) return set;
          }
        }
      }
    }
    return set;
  };

  const confirmVariants = buildCombinations({
    prefixes: confirmPrefixes,
    subjects: confirmSubjects,
    actions: confirmActions,
    tails: confirmTails,
    maxSize: 4500,
  });
  const cancelVariants = buildCombinations({
    prefixes: cancelPrefixes,
    subjects: cancelSubjects,
    actions: cancelActions,
    tails: cancelTails,
    maxSize: 4500,
  });

  return {
    confirmVariants,
    cancelVariants,
  };
}

const LEXICON = buildLexicon();

const CONFIRM_KEYWORDS = new Set([
  'si',
  'ok',
  'okay',
  'oki',
  'dale',
  'deuna',
  'voy',
  'asisto',
  'asistire',
  'llego',
  'confirmo',
  'confirmado',
  'correcto',
  'correcta',
  'exacto',
  'exacta',
  'ready',
  'right',
  'presente',
  'estare',
  'puntual',
  'listo',
  'genial',
  'joya',
  'claro',
]);

const CANCEL_KEYWORDS = new Set([
  'no',
  'cancelar',
  'cancelo',
  'anular',
  'reprogramar',
  'imposible',
  'complico',
  'complica',
  'problema',
  'llego',
  'podre',
  'puedo',
  'faltar',
  'otro',
  'fecha',
  'dia',
  'tarde',
]);

const CANCEL_REGEXES = [
  /\bno\s+(voy|ire|puedo|podre|llego|llegare|asisto|asistire)\b/,
  /\b(cancela|cancelar|cancelo|cancelame|cancelalo)\b/,
  /\b(anular|anulo|anulalo)\b/,
  /\b(reprogramar|reprogramemos|pasar\s+para\s+otro\s+dia)\b/,
  /\b(se\s+me\s+complic(a|o)|tuve\s+un\s+problema|imposible)\b/,
];

const CONFIRM_REGEXES = [
  /\bsi\s+voy\b/,
  /\bsi\s+asisto\b/,
  /\bvoy\s+a\s+ir\b/,
  /\b(confirmo|confirmado)\b/,
  /\b(correcto|correcta|exacto|exacta)\b/,
  /\b(all good|that s right|right)\b/,
  /\b(llego|estare)\b/,
  /\b(de\s+una|listo|joya|genial)\b/,
];

function hasNgramMatch(tokens, lexiconSet, maxLen = 5) {
  if (!tokens.length) return false;
  for (let i = 0; i < tokens.length; i += 1) {
    let phrase = '';
    for (let len = 1; len <= maxLen && i + len <= tokens.length; len += 1) {
      phrase = len === 1 ? tokens[i] : `${phrase} ${tokens[i + len - 1]}`;
      if (lexiconSet.has(phrase)) return true;
    }
  }
  return false;
}

function countKeywordHits(tokens, set) {
  let score = 0;
  for (const token of tokens) {
    if (set.has(token)) score += 1;
  }
  return score;
}

function anyRegexMatch(text, regexes) {
  return regexes.some(regex => regex.test(text));
}

function resolveReminderIntent(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return { intent: 'unknown', confidence: 0, normalized };
  }

  const tokens = tokenize(normalized);
  const confirmLexiconHit = hasNgramMatch(tokens, LEXICON.confirmVariants);
  const cancelLexiconHit = hasNgramMatch(tokens, LEXICON.cancelVariants);
  const confirmRegexHit = anyRegexMatch(normalized, CONFIRM_REGEXES);
  const cancelRegexHit = anyRegexMatch(normalized, CANCEL_REGEXES);

  let confirmScore = 0;
  let cancelScore = 0;

  if (confirmLexiconHit) confirmScore += 2;
  if (cancelLexiconHit) cancelScore += 2;
  if (confirmRegexHit) confirmScore += 3;
  if (cancelRegexHit) cancelScore += 3;

  confirmScore += countKeywordHits(tokens, CONFIRM_KEYWORDS);
  cancelScore += countKeywordHits(tokens, CANCEL_KEYWORDS);

  // Dominancia negativa: "no + confirmacion" sigue siendo cancelacion.
  if (tokens.includes('no') && (tokens.includes('voy') || tokens.includes('asisto'))) {
    cancelScore += 4;
  }
  // Dominancia positiva para respuestas cortas.
  if (normalized === 'si' || normalized === 'ok') {
    confirmScore += 3;
  }
  if (normalized === '1') {
    confirmScore += 5;
  }
  if (normalized === '2') {
    cancelScore += 5;
  }

  if (cancelScore >= 4 && cancelScore >= confirmScore + 1) {
    return { intent: 'cancel', confidence: cancelScore, normalized };
  }

  if (confirmScore >= 4 && confirmScore >= cancelScore + 1) {
    return { intent: 'confirm', confidence: confirmScore, normalized };
  }

  return { intent: 'unknown', confidence: Math.max(confirmScore, cancelScore), normalized };
}

function getReminderLexiconStats() {
  return {
    confirmVariants: LEXICON.confirmVariants.size,
    cancelVariants: LEXICON.cancelVariants.size,
    totalVariants: LEXICON.confirmVariants.size + LEXICON.cancelVariants.size,
  };
}

module.exports = {
  resolveReminderIntent,
  getReminderLexiconStats,
  normalizeText,
};
