/**
 * Bikram Sambat (BS) ↔ Gregorian (AD) calendar conversion utility.
 * Nepal uses BS which is approximately 56 years and 8 months ahead of AD.
 * Reference lookup tables for accurate month-by-month conversion.
 */

// Days in each month of BS calendar from 2000 BS to 2090 BS
const BS_MONTH_DAYS: number[][] = [
  [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2000
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2001
  [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2002
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2003
  [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2004
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2005
  [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2006
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2007
  [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 29, 31], // 2008
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2009
  [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2010
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2011
  [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30], // 2012
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2013
  [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2014
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2015
  [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30], // 2016
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2017
  [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2018
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2019
  [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30], // 2020 BS = 1963/64 AD
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2021
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30], // 2022
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2023
  [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30], // 2024
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2025
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2026
  [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2027
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2028
  [31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30], // 2029
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2030
  [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2031
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2032
  [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2033
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2034
  [30, 32, 31, 32, 31, 31, 29, 30, 30, 29, 29, 31], // 2035
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2036
  [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2037
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2038
  [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30], // 2039
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2040
  [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2041
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2042
  [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30], // 2043
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2044
  [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2045
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2046
  [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30], // 2047
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2048
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30], // 2049
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2050
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2051
  [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2052
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2053
  [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2054
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2055
  [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2056
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2057
  [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2058
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2059
  [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2060
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2061
  [30, 32, 31, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2062
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2063
  [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2064
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2065
  [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 29, 31], // 2066
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2067
  [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2068
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2069
  [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30], // 2070
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2071
  [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2072
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2073
  [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30], // 2074
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2075
  [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2076
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2077
  [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30], // 2078
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2079
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30], // 2080
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2081
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2082
  [31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30], // 2083
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2084
  [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2085
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2086
  [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2087
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2088
  [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2089
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2090
]

export interface BSDate {
  year: number
  month: number // 1-12
  day: number
}

const BS_START_YEAR = 2000
// AD date corresponding to BS 2000 Baisakh 1 (April 13/14, 1943)
const AD_REF_YEAR = 1943
const AD_REF_MONTH = 4 // April
const AD_REF_DAY = 14

/** Convert Gregorian (AD) date to Bikram Sambat (BS). */
export function adToBS(adDate: Date): BSDate {
  // Total days from reference
  const refDate = new Date(AD_REF_YEAR, AD_REF_MONTH - 1, AD_REF_DAY)
  const diffDays = Math.floor((adDate.getTime() - refDate.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays < 0) throw new Error('Date before BS 2000 not supported')

  let bsYear = BS_START_YEAR
  let remaining = diffDays

  // Iterate through BS years
  while (true) {
    const idx = bsYear - BS_START_YEAR
    if (idx >= BS_MONTH_DAYS.length) throw new Error('Date beyond supported BS range')
    const daysInYear = BS_MONTH_DAYS[idx].reduce((a, b) => a + b, 0)
    if (remaining < daysInYear) break
    remaining -= daysInYear
    bsYear++
  }

  const monthDays = BS_MONTH_DAYS[bsYear - BS_START_YEAR]
  let bsMonth = 1
  while (remaining >= monthDays[bsMonth - 1]) {
    remaining -= monthDays[bsMonth - 1]
    bsMonth++
  }

  return { year: bsYear, month: bsMonth, day: remaining + 1 }
}

/** Convert BS date to Gregorian (AD) Date. */
export function bsToAD(bsDate: BSDate): Date {
  const { year, month, day } = bsDate
  let totalDays = 0

  for (let y = BS_START_YEAR; y < year; y++) {
    totalDays += BS_MONTH_DAYS[y - BS_START_YEAR].reduce((a, b) => a + b, 0)
  }
  const monthDays = BS_MONTH_DAYS[year - BS_START_YEAR]
  for (let m = 1; m < month; m++) {
    totalDays += monthDays[m - 1]
  }
  totalDays += day - 1

  const ref = new Date(AD_REF_YEAR, AD_REF_MONTH - 1, AD_REF_DAY)
  const result = new Date(ref.getTime() + totalDays * 24 * 60 * 60 * 1000)
  return result
}

export const BS_MONTHS_EN = [
  'Baisakh', 'Jestha', 'Ashadh', 'Shrawan', 'Bhadra', 'Ashwin',
  'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra',
]

export const BS_MONTHS_NE = [
  'बैशाख', 'जेठ', 'असार', 'साउन', 'भदौ', 'असोज',
  'कार्तिक', 'मंसिर', 'पुस', 'माघ', 'फागुन', 'चैत',
]

/** Number of days in a given BS year/month (1-12), per the lookup table above. */
export function daysInBSMonth(year: number, month: number): number {
  const idx = year - BS_START_YEAR
  if (idx < 0 || idx >= BS_MONTH_DAYS.length) throw new Error('BS year out of supported range')
  return BS_MONTH_DAYS[idx][month - 1]
}

/** Min/max BS years covered by the lookup table. */
export function getBSYearRange(): { min: number; max: number } {
  return { min: BS_START_YEAR, max: BS_START_YEAR + BS_MONTH_DAYS.length - 1 }
}

const NEPALI_DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९']

export function toNepaliDigits(num: number | string): string {
  return String(num)
    .split('')
    .map((ch) => (ch >= '0' && ch <= '9' ? NEPALI_DIGITS[parseInt(ch)] : ch))
    .join('')
}

export function formatBSDate(bs: BSDate, lang: 'en' | 'ne' = 'en'): string {
  const months = lang === 'ne' ? BS_MONTHS_NE : BS_MONTHS_EN
  const monthName = months[bs.month - 1]
  if (lang === 'ne') {
    return `${toNepaliDigits(bs.year)} ${monthName} ${toNepaliDigits(bs.day)}`
  }
  return `${bs.year} ${monthName} ${bs.day}`
}

/** Format a JS Date as AD in locale format. */
export function formatADDate(date: Date, lang: 'en' | 'ne' = 'en'): string {
  return date.toLocaleDateString(lang === 'ne' ? 'ne-NP' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/** Format NPR currency */
export function formatNPR(amount: number, lang: 'en' | 'ne' = 'en'): string {
  const formatted = new Intl.NumberFormat('en-NP', {
    style: 'currency',
    currency: 'NPR',
    minimumFractionDigits: 2,
  }).format(amount)

  if (lang === 'ne') {
    // Replace digits with Nepali digits
    return formatted.replace(/\d/g, (d) => NEPALI_DIGITS[parseInt(d)])
  }
  return formatted
}

/** Get today's BS date */
export function todayBS(): BSDate {
  return adToBS(new Date())
}

/** Format ISO string or Date to display date per calendar preference */
export function formatDate(
  dateInput: string | Date,
  calendarType: 'AD' | 'BS',
  lang: 'en' | 'ne' = 'en'
): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput
  if (calendarType === 'BS') {
    try {
      return formatBSDate(adToBS(date), lang)
    } catch {
      // Fallback to AD if date is outside the BS lookup table range
      return formatADDate(date, lang)
    }
  }
  return formatADDate(date, lang)
}
