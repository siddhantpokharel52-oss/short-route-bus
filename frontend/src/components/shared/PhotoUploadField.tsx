/**
 * PhotoUploadField — a small, optional image upload with a live preview,
 * matching the same click-to-upload/change/discard pattern already used for
 * the company logo upload in TenantSettingsPage. Used for the (all-optional,
 * fillable later via Edit) profile photo and license/citizenship photo
 * fields on Drivers and Conductors.
 *
 * This only tracks the picked File and reports it via onFileChange -- the
 * parent decides when/how to actually upload it (multipart only when a file
 * is present, plain JSON otherwise, same as the company logo save flow).
 */
import { useRef, useState } from 'react'
import { Upload, X, ImageIcon } from 'lucide-react'
import toast from 'react-hot-toast'
import { getMediaPath } from '@utils/media'

interface PhotoUploadFieldProps {
  label: string
  hint?: string
  existingUrl?: string | null
  onFileChange: (file: File | null) => void
}

// `accept="image/*"` on the <input> is only a hint to the OS file picker --
// it doesn't stop someone choosing "All Files" and picking a renamed .txt,
// nor does it distinguish a raster image from an SVG (whose content is just
// XML text and can carry an embedded <script>, a known upload-XSS vector).
// The backend's Django ImageField already rejects both via Pillow, but the
// UI was showing a false "Uploaded" success before that rejection ever
// happened -- this checks the real file signature (magic bytes) up front so
// a bad file is caught immediately instead of silently failing at save time.
async function looksLikeARealImage(file: File): Promise<boolean> {
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) return false
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  const isGif = bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 // "GIF"
  const isWebp =
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // "RIFF"
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 // "WEBP"
  return isJpeg || isPng || isGif || isWebp
}

export function PhotoUploadField({ label, hint, existingUrl, onFileChange }: PhotoUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const currentSrc = preview ?? getMediaPath(existingUrl)

  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 transition-colors hover:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-400 dark:border-gray-600 dark:bg-gray-800"
        >
          {currentSrc ? (
            <img src={currentSrc} alt={label} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-gray-400">
              <ImageIcon className="h-6 w-6" />
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/25 group-hover:opacity-100">
            <Upload className="h-5 w-5 text-white drop-shadow" />
          </div>
        </button>

        <div className="min-w-0 flex-1">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {currentSrc ? 'Uploaded' : 'Not uploaded yet — optional'}
          </p>
          {hint && <p className="mt-0.5 text-xs text-gray-400">{hint}</p>}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="text-xs font-medium text-primary-600 hover:underline"
            >
              {currentSrc ? 'Change' : 'Upload'}
            </button>
            {preview && (
              <button
                type="button"
                onClick={() => { setPreview(null); onFileChange(null) }}
                className="flex items-center gap-0.5 text-xs text-red-500 hover:underline"
              >
                <X className="h-3 w-3" /> Discard
              </button>
            )}
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (!file) return
            if (file.size > 2 * 1024 * 1024) {
              toast.error('Image must be under 2MB.')
              e.target.value = ''
              return
            }
            if (!(await looksLikeARealImage(file))) {
              toast.error("That doesn't look like a real photo (JPEG, PNG, GIF or WebP). SVG and other file types aren't accepted.")
              e.target.value = ''
              return
            }
            setPreview(URL.createObjectURL(file))
            onFileChange(file)
          }}
        />
      </div>
    </div>
  )
}
