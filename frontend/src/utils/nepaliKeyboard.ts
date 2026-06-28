/**
 * Romanized Nepali Unicode converter (Ashesh.com.np-compatible standard)
 *
 * Typing rules:
 *   - Adjacent consonants without a vowel between them form conjuncts (halant added automatically)
 *   - 'a'  after consonant = inherent vowel (no matra, consonant stays as-is)
 *   - 'aa' after consonant = ा  matra
 *   - 'i'  after consonant = ि matra    'ee'/'I' = ी matra
 *   - 'u'  after consonant = ु matra    'oo'/'U' = ू matra
 *   - 'e'  after consonant = े matra    'ai'     = ै matra
 *   - 'o'  after consonant = ो matra    'au'     = ौ matra
 *   - 'M'  = anusvara (ं)   'H' = visarga (ः)
 *   - '^'  = explicit halant (्)
 *   - '.'  = danda (।)      '..' = double danda (॥)
 *   - 0–9  = Nepali numerals (०–९)
 *
 * Examples:
 *   namaste   → नमस्ते
 *   kaaThamaaDauM → काठमाडौं
 *   nepal     → नेपाल    (n+e+p+aa+l → न+े+प+ा+ल)
 *   dhanyabaad → धन्यवाद
 */

const HALANT = '्'
const ANUSVARA = 'ं'
const VISARGA = 'ः'
const NEPALI_DIGITS = '०१२३४५६७८९'

type Pattern = {
  roman: string
  devanagari: string
  isConsonant: boolean
  /** null = not a vowel | '' = inherent 'a' (no matra) | string = matra char */
  matra: string | null
}

// Patterns sorted longest-first so greedy matching works correctly
const PATTERNS: Pattern[] = [
  // ── 3-char clusters ───────────────────────────────────────────────────────
  { roman: 'ksh', devanagari: 'क्ष', isConsonant: true,  matra: null },
  { roman: 'gny', devanagari: 'ज्ञ', isConsonant: true,  matra: null },
  { roman: 'chh', devanagari: 'छ',   isConsonant: true,  matra: null },
  // ── 2-char consonants ─────────────────────────────────────────────────────
  { roman: 'kh',  devanagari: 'ख',   isConsonant: true,  matra: null },
  { roman: 'gh',  devanagari: 'घ',   isConsonant: true,  matra: null },
  { roman: 'ng',  devanagari: 'ङ',   isConsonant: true,  matra: null },
  { roman: 'ch',  devanagari: 'च',   isConsonant: true,  matra: null },
  { roman: 'jh',  devanagari: 'झ',   isConsonant: true,  matra: null },
  { roman: 'ny',  devanagari: 'ञ',   isConsonant: true,  matra: null },
  { roman: 'Th',  devanagari: 'ठ',   isConsonant: true,  matra: null },
  { roman: 'Dh',  devanagari: 'ढ',   isConsonant: true,  matra: null },
  { roman: 'th',  devanagari: 'थ',   isConsonant: true,  matra: null },
  { roman: 'dh',  devanagari: 'ध',   isConsonant: true,  matra: null },
  { roman: 'ph',  devanagari: 'फ',   isConsonant: true,  matra: null },
  { roman: 'bh',  devanagari: 'भ',   isConsonant: true,  matra: null },
  { roman: 'Sh',  devanagari: 'ष',   isConsonant: true,  matra: null },
  { roman: 'sh',  devanagari: 'श',   isConsonant: true,  matra: null },
  // ── 2-char vowels (must come before single-char consonants) ───────────────
  { roman: 'aa',  devanagari: 'आ',   isConsonant: false, matra: 'ा' },
  { roman: 'ai',  devanagari: 'ऐ',   isConsonant: false, matra: 'ै' },
  { roman: 'au',  devanagari: 'औ',   isConsonant: false, matra: 'ौ' },
  { roman: 'ee',  devanagari: 'ई',   isConsonant: false, matra: 'ी' },
  { roman: 'oo',  devanagari: 'ऊ',   isConsonant: false, matra: 'ू' },
  { roman: 'ri',  devanagari: 'ऋ',   isConsonant: false, matra: 'ृ' },
  // ── Single consonants ─────────────────────────────────────────────────────
  { roman: 'k',   devanagari: 'क',   isConsonant: true,  matra: null },
  { roman: 'g',   devanagari: 'ग',   isConsonant: true,  matra: null },
  { roman: 'c',   devanagari: 'च',   isConsonant: true,  matra: null },
  { roman: 'j',   devanagari: 'ज',   isConsonant: true,  matra: null },
  { roman: 'T',   devanagari: 'ट',   isConsonant: true,  matra: null },
  { roman: 'D',   devanagari: 'ड',   isConsonant: true,  matra: null },
  { roman: 'N',   devanagari: 'ण',   isConsonant: true,  matra: null },
  { roman: 't',   devanagari: 'त',   isConsonant: true,  matra: null },
  { roman: 'd',   devanagari: 'द',   isConsonant: true,  matra: null },
  { roman: 'n',   devanagari: 'न',   isConsonant: true,  matra: null },
  { roman: 'p',   devanagari: 'प',   isConsonant: true,  matra: null },
  { roman: 'b',   devanagari: 'ब',   isConsonant: true,  matra: null },
  { roman: 'm',   devanagari: 'म',   isConsonant: true,  matra: null },
  { roman: 'y',   devanagari: 'य',   isConsonant: true,  matra: null },
  { roman: 'r',   devanagari: 'र',   isConsonant: true,  matra: null },
  { roman: 'l',   devanagari: 'ल',   isConsonant: true,  matra: null },
  { roman: 'v',   devanagari: 'व',   isConsonant: true,  matra: null },
  { roman: 'w',   devanagari: 'व',   isConsonant: true,  matra: null },
  { roman: 's',   devanagari: 'स',   isConsonant: true,  matra: null },
  { roman: 'h',   devanagari: 'ह',   isConsonant: true,  matra: null },
  { roman: 'f',   devanagari: 'फ',   isConsonant: true,  matra: null },
  // ── Uppercase shortcuts for long vowels ───────────────────────────────────
  { roman: 'A',   devanagari: 'आ',   isConsonant: false, matra: 'ा' },
  { roman: 'I',   devanagari: 'ई',   isConsonant: false, matra: 'ी' },
  { roman: 'U',   devanagari: 'ऊ',   isConsonant: false, matra: 'ू' },
  // ── Single vowels ─────────────────────────────────────────────────────────
  { roman: 'a',   devanagari: 'अ',   isConsonant: false, matra: '' },   // '' = inherent a
  { roman: 'i',   devanagari: 'इ',   isConsonant: false, matra: 'ि' },
  { roman: 'u',   devanagari: 'उ',   isConsonant: false, matra: 'ु' },
  { roman: 'e',   devanagari: 'ए',   isConsonant: false, matra: 'े' },
  { roman: 'o',   devanagari: 'ओ',   isConsonant: false, matra: 'ो' },
]

/**
 * Convert a full Roman string to Devanagari.
 * Handles consonant conjuncts, matras, anusvara, visarga, digits and punctuation.
 */
export function romanToNepali(roman: string): string {
  let result = ''
  let i = 0
  let afterConsonant = false

  while (i < roman.length) {
    const ch = roman[i]

    // ── Whitespace & pass-through punctuation ─────────────────────────────
    if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '-' || ch === '—' || ch === '(' || ch === ')' || ch === ',' || ch === ';' || ch === ':' || ch === '!' || ch === '?') {
      result += ch
      afterConsonant = false
      i++
      continue
    }

    // ── Explicit halant ───────────────────────────────────────────────────
    if (ch === '^') {
      result += HALANT
      afterConsonant = false
      i++
      continue
    }

    // ── Anusvara (M) ──────────────────────────────────────────────────────
    if (ch === 'M') {
      result += ANUSVARA
      afterConsonant = false
      i++
      continue
    }

    // ── Visarga (H standalone) ────────────────────────────────────────────
    if (ch === 'H') {
      result += VISARGA
      afterConsonant = false
      i++
      continue
    }

    // ── Nepali digits ─────────────────────────────────────────────────────
    if (ch >= '0' && ch <= '9') {
      result += NEPALI_DIGITS[parseInt(ch)]
      afterConsonant = false
      i++
      continue
    }

    // ── Double danda ──────────────────────────────────────────────────────
    if (roman.startsWith('..', i)) {
      result += '॥'
      afterConsonant = false
      i += 2
      continue
    }

    // ── Single danda ──────────────────────────────────────────────────────
    if (ch === '.') {
      result += '।'
      afterConsonant = false
      i++
      continue
    }

    // ── Greedy pattern match ──────────────────────────────────────────────
    let matched = false
    for (const p of PATTERNS) {
      if (roman.startsWith(p.roman, i)) {
        if (p.isConsonant) {
          if (afterConsonant) {
            // Consonant cluster: add halant before new consonant
            result += HALANT + p.devanagari
          } else {
            result += p.devanagari
          }
          afterConsonant = true
        } else {
          // Vowel
          if (afterConsonant) {
            result += p.matra!   // '' for inherent 'a' (no change), else matra char
          } else {
            result += p.devanagari  // standalone independent vowel
          }
          afterConsonant = false
        }
        i += p.roman.length
        matched = true
        break
      }
    }

    if (!matched) {
      result += ch
      afterConsonant = false
      i++
    }
  }

  return result
}

/** Quick reference for the on-screen cheat sheet */
export const KEYBOARD_CHEATSHEET = [
  { label: 'अ', hint: 'a' }, { label: 'आ', hint: 'aa/A' }, { label: 'इ', hint: 'i' },
  { label: 'ई', hint: 'ee/I' }, { label: 'उ', hint: 'u' }, { label: 'ऊ', hint: 'oo/U' },
  { label: 'ए', hint: 'e' }, { label: 'ऐ', hint: 'ai' }, { label: 'ओ', hint: 'o' },
  { label: 'औ', hint: 'au' }, { label: 'ऋ', hint: 'ri' },
  { label: 'क', hint: 'k' }, { label: 'ख', hint: 'kh' }, { label: 'ग', hint: 'g' },
  { label: 'घ', hint: 'gh' }, { label: 'ङ', hint: 'ng' }, { label: 'च', hint: 'ch' },
  { label: 'छ', hint: 'chh' }, { label: 'ज', hint: 'j' }, { label: 'झ', hint: 'jh' },
  { label: 'ञ', hint: 'ny' }, { label: 'ट', hint: 'T' }, { label: 'ठ', hint: 'Th' },
  { label: 'ड', hint: 'D' }, { label: 'ढ', hint: 'Dh' }, { label: 'ण', hint: 'N' },
  { label: 'त', hint: 't' }, { label: 'थ', hint: 'th' }, { label: 'द', hint: 'd' },
  { label: 'ध', hint: 'dh' }, { label: 'न', hint: 'n' }, { label: 'प', hint: 'p' },
  { label: 'फ', hint: 'ph/f' }, { label: 'ब', hint: 'b' }, { label: 'भ', hint: 'bh' },
  { label: 'म', hint: 'm' }, { label: 'य', hint: 'y' }, { label: 'र', hint: 'r' },
  { label: 'ल', hint: 'l' }, { label: 'व', hint: 'v/w' }, { label: 'श', hint: 'sh' },
  { label: 'ष', hint: 'Sh' }, { label: 'स', hint: 's' }, { label: 'ह', hint: 'h' },
  { label: 'ं', hint: 'M' }, { label: 'ः', hint: 'H' }, { label: '्', hint: '^' },
  { label: 'क्ष', hint: 'ksh' }, { label: 'ज्ञ', hint: 'gny' }, { label: '।', hint: '.' },
]
