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
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (!file) return
            if (file.size > 2 * 1024 * 1024) {
              toast.error('Image must be under 2MB.')
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
