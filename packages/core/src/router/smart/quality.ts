/**
 * Quality priors for live OpenRouter models.
 *
 * OpenRouter's `/models` payload tells us price, context window, and
 * capabilities - but NOT how *good* a model is. The smart router needs a
 * coarse quality signal to avoid auto-selecting a cheap-but-weak model
 * for a hard task. We derive that signal from the model id's family +
 * tier keywords.
 *
 * Why keyword rules and not a hardcoded model list? Because the whole
 * point of the smart router is to adapt as OpenRouter's lineup changes.
 * Matching on families (`claude … sonnet`, `gpt-5`, `… -mini`) means a
 * new point release (`claude-sonnet-4.6`, `gpt-5.1`) inherits the right
 * tier with zero code changes. This is intentionally a *prior*, not a
 * benchmark - tune the rules as real-world results come in.
 */

export type QualityTier = 'frontier' | 'strong' | 'mid' | 'small' | 'unknown';

export const TIER_SCORE: Record<QualityTier, number> = {
  frontier: 0.95,
  strong: 0.8,
  mid: 0.62,
  small: 0.45,
  unknown: 0.5,
};

/**
 * Ordered match rules; first hit wins. Matched against the lowercased
 * model id (`vendor/model-name`).
 *
 * `small` is checked first on purpose: `gpt-4o-mini` should land in the
 * cheap tier, not inherit `gpt-4o`'s `strong` rating.
 */
const RULES: ReadonlyArray<{ re: RegExp; tier: QualityTier }> = [
  // Small / cheap tier (and explicitly-free variants). Note the word
  // boundaries on `mini`/`nano`/`tiny` so they don't match *inside*
  // larger names (e.g. "mini" must not flag "ge-mini-2.5-pro").
  {
    re: /(\bmini|\bnano|haiku|flash-lite|-8b|-7b|-4b|-3b|-1\.5b|\btiny\b|gemma|:free)/,
    tier: 'small',
  },
  // Frontier tier: top reasoning / refactor models.
  {
    re: /(opus|gpt-5|o3|o4-|gemini-2\.5-pro|grok-4|deepseek-r1|deepseek.*reasoner|sonnet-4|llama-4-maverick)/,
    tier: 'frontier',
  },
  // Strong daily-driver tier.
  {
    re: /(sonnet|gpt-4o|gpt-4\.1|gemini-2\.5-flash|gemini-1\.5-pro|deepseek-v3|deepseek-chat|grok-3|llama-3\.3-70b|llama-3\.1-405b|qwen3|qwen-?2\.5-72b|command-r-plus|mistral-large)/,
    tier: 'strong',
  },
  // Mid tier.
  {
    re: /(llama-3\.1-70b|qwen-?2\.5-32b|mixtral|command-r|mistral-medium|gemini-1\.5-flash|glm-4)/,
    tier: 'mid',
  },
];

/** Coarse quality tier for a model id. */
export function qualityTier(id: string): QualityTier {
  const v = id.toLowerCase();
  for (const rule of RULES) {
    if (rule.re.test(v)) return rule.tier;
  }
  return 'unknown';
}

/** Quality prior in [0,1] for a model id. */
export function qualityPrior(id: string): number {
  return TIER_SCORE[qualityTier(id)];
}

/**
 * Heuristic "is this a reasoning model" check from the id + the
 * `supported_parameters` OpenRouter advertises. Used to bias the
 * `deep-reasoning` intent.
 */
export function isReasoningModel(id: string, supportedParameters?: string[]): boolean {
  if (Array.isArray(supportedParameters)) {
    if (
      supportedParameters.includes('reasoning') ||
      supportedParameters.includes('include_reasoning')
    ) {
      return true;
    }
  }
  const v = id.toLowerCase();
  return /(o3|o4-|gpt-5|deepseek-r1|deepseek.*reasoner|grok-4|gemini-2\.5-pro|:thinking|-thinking|magistral|qwq)/.test(
    v,
  );
}
