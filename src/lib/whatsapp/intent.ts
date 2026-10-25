export type ReplyIntent = "CONFIRM" | "CANCEL" | "AMBIGUOUS" | "OTHER";

const norm = (s: string) =>
  s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9'?\s]/g, " ").replace(/\s+/g, " ").trim();

const CONFIRM = /\b(yes|yeah|yep|yup|confirm|confirmed|ok|okay|sure|haan|han|ha|go ahead|proceed|place it|cod is (ok|okay|fine|good)|i want to (purchase|buy)( this)?( product| item)?)\b/;
const CANCEL = /\b(cancel|cancelled|canceled|not interested|no thanks|no thank you|refuse|nahi|nahin|nope|don't want|dont want|do not want|remove my order)\b/;
const NEG_CANCEL = /\b(don't|dont|do not|not)\s+(want to\s+)?cancel\b/g;
const NEG_CONFIRM = /\b(don't|dont|do not|not)\s+(want to\s+)?(confirm|purchase|buy|order)\b/;
const UNSURE = /\b(not sure|unsure|maybe|later|think about|wait|hold on|change|modify|different|another size|exchange)\b/;
const MAX_REPLY_WORDS = 10;
const BULK_OR_META = /\b(ignore|instruction|instructions|system|prompt|every|all (my )?orders?|everything|assistant|override)\b/;
const QUESTION = /\?|\b(what|why|when|how|where|which|who|price|cost)\b/;

/**
 * Deterministic classifier for replies to a COD confirmation request.
 * Anything not clearly affirmative or clearly negative is AMBIGUOUS/OTHER and results in a clarifying question.
 */
export function classifyReply(raw: string): ReplyIntent {
  const t = norm(raw);
  if (!t) return "OTHER";
  if (UNSURE.test(t)) return "AMBIGUOUS";
  // Only short, plain replies may confirm or cancel. Long messages and bulk/meta wording ("every order",
  // "ignore instructions") always get a clarifying question, so pasted text can never change an order.
  const words = t.split(" ").length;
  if (BULK_OR_META.test(t)) return "AMBIGUOUS";
  if (words > MAX_REPLY_WORDS) return CONFIRM.test(t) || CANCEL.test(t) ? "AMBIGUOUS" : "OTHER";
  const keep = NEG_CANCEL.test(t);
  const t2 = t.replace(NEG_CANCEL, " ");
  if (NEG_CONFIRM.test(t2)) return "CANCEL";
  const startsNo = /^(no|n|nope)\b/.test(t2);
  const cancel = CANCEL.test(t2) || startsNo;
  const confirm = CONFIRM.test(t2) || keep;
  if (cancel && confirm) return "AMBIGUOUS"; // e.g. "yes cancel it", "no, I confirm"
  if (cancel) return "CANCEL";
  if (confirm) {
    const plainYes = /^(yes|yeah|yep|yup|ok|okay|sure|confirm|confirmed|haan|han|ha)\b[ .!]*$/.test(t2);
    return QUESTION.test(t2) && !plainYes ? "AMBIGUOUS" : "CONFIRM";
  }
  return "OTHER";
}

export function isOptOut(raw: string): boolean {
  return /^(stop|unsubscribe|opt ?out|stop messages)$/.test(norm(raw));
}
export function isOptIn(raw: string): boolean {
  return /^(start|subscribe|opt ?in)$/.test(norm(raw));
}

export function extractOrderRef(raw: string): string | null {
  const m = /\bTF[-\s]?([A-Z0-9]{6})\b/i.exec(raw);
  return m ? `TF-${(m[1] as string).toUpperCase()}` : null;
}
