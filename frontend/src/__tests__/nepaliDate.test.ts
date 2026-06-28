import { adToBS, bsToAD, formatBSDate, toNepaliDigits, formatNPR, formatDate } from '../utils/nepaliDate'

describe('nepaliDate utilities', () => {
  describe('adToBS', () => {
    it('converts a known AD date to BS', () => {
      // June 20, 2024 AD should be Ashadh 7, 2081 BS
      const bs = adToBS(new Date(2024, 5, 20))
      expect(bs.year).toBe(2081)
      expect(bs.month).toBe(3) // Ashadh is month 3
      expect(bs.day).toBe(7)
    })

    it('converts reference date correctly', () => {
      // April 14, 1943 AD = BS 2000 Baisakh 1
      const bs = adToBS(new Date(1943, 3, 14))
      expect(bs.year).toBe(2000)
      expect(bs.month).toBe(1)
      expect(bs.day).toBe(1)
    })
  })

  describe('bsToAD', () => {
    it('converts BS date back to AD', () => {
      const ad = bsToAD({ year: 2081, month: 3, day: 7 })
      expect(ad.getFullYear()).toBe(2024)
      expect(ad.getMonth()).toBe(5) // June (0-indexed)
      expect(ad.getDate()).toBe(20)
    })

    it('round-trips correctly', () => {
      const original = new Date(2024, 0, 15) // Jan 15, 2024
      const bs = adToBS(original)
      const back = bsToAD(bs)
      expect(back.getFullYear()).toBe(original.getFullYear())
      expect(back.getMonth()).toBe(original.getMonth())
      expect(back.getDate()).toBe(original.getDate())
    })
  })

  describe('toNepaliDigits', () => {
    it('converts Arabic to Nepali digits', () => {
      expect(toNepaliDigits(2024)).toBe('२०२४')
      expect(toNepaliDigits('123')).toBe('१२३')
      expect(toNepaliDigits(0)).toBe('०')
    })

    it('passes through non-digit characters', () => {
      expect(toNepaliDigits('BS 2081')).toBe('BS २०८१')
    })
  })

  describe('formatBSDate', () => {
    it('formats BS date in English', () => {
      const result = formatBSDate({ year: 2081, month: 3, day: 7 }, 'en')
      expect(result).toBe('2081 Ashadh 7')
    })

    it('formats BS date in Nepali', () => {
      const result = formatBSDate({ year: 2081, month: 3, day: 7 }, 'ne')
      expect(result).toContain('असार')
      expect(result).toContain('२०८१')
    })
  })

  describe('formatNPR', () => {
    it('formats NPR currency', () => {
      const result = formatNPR(1500.50, 'en')
      expect(result).toContain('1,500')
    })
  })

  describe('formatDate', () => {
    it('formats date as AD when calendarType is AD', () => {
      const result = formatDate('2024-06-20', 'AD', 'en')
      expect(result).toContain('2024')
    })

    it('formats date as BS when calendarType is BS', () => {
      const result = formatDate(new Date(2024, 5, 20), 'BS', 'en')
      expect(result).toContain('2081')
      expect(result).toContain('Ashadh')
    })
  })
})
