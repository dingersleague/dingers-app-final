'use client'

import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { Camera, Save, Trash2, Palette } from 'lucide-react'
import TeamLogo from '@/components/TeamLogo'

interface TeamData {
  id: string
  name: string
  abbreviation: string
  logoUrl: string | null
  primaryColor: string | null
  secondaryColor: string | null
}

const COLOR_PRESETS = [
  '#EF4444', '#F97316', '#EAB308', '#22C55E', '#00DC52',
  '#06B6D4', '#3B82F6', '#6366F1', '#A855F7', '#EC4899',
  '#F43F5E', '#14B8A6', '#8B5CF6', '#D946EF', '#FFFFFF',
]

export default function TeamSettingsClient({ team }: { team: TeamData }) {
  const [name, setName] = useState(team.name)
  const [abbreviation, setAbbreviation] = useState(team.abbreviation)
  const [logoUrl, setLogoUrl] = useState<string | null>(team.logoUrl)
  const [primaryColor, setPrimaryColor] = useState<string>(team.primaryColor ?? '#00DC52')
  const [secondaryColor, setSecondaryColor] = useState<string>(team.secondaryColor ?? '#1e2d42')
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be under 5MB')
      return
    }

    // Resize and compress client-side
    const dataUrl = await resizeImage(file, 256, 256, 0.85)
    setLogoUrl(dataUrl)
    toast.success('Logo uploaded — save to apply')
  }

  function resizeImage(file: File, maxW: number, maxH: number, quality: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let w = img.width
        let h = img.height

        if (w > maxW || h > maxH) {
          const ratio = Math.min(maxW / w, maxH / h)
          w = Math.round(w * ratio)
          h = Math.round(h * ratio)
        }

        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/webp', quality))
      }
      img.onerror = reject
      img.src = URL.createObjectURL(file)
    })
  }

  async function handleSave() {
    if (!name.trim() || name.length < 2) {
      toast.error('Team name must be at least 2 characters')
      return
    }
    if (!abbreviation.trim() || abbreviation.length < 2 || abbreviation.length > 5) {
      toast.error('Abbreviation must be 2-5 characters')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/team', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          abbreviation: abbreviation.trim().toUpperCase(),
          logoUrl,
          primaryColor,
          secondaryColor,
        }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Team settings saved!')
      } else {
        toast.error(data.error || 'Save failed')
      }
    } catch {
      toast.error('Failed to save')
    }
    setSaving(false)
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <div>
        <h1 className="font-display font-black text-4xl tracking-tight">Team Settings</h1>
        <p className="text-text-muted text-sm mt-1">Customize your team identity</p>
      </div>

      {/* Preview */}
      <div className="card p-6">
        <div className="flex items-center gap-4 mb-6">
          <TeamLogo
            logoUrl={logoUrl}
            abbreviation={abbreviation}
            primaryColor={primaryColor}
            secondaryColor={secondaryColor}
            size="xl"
          />
          <div>
            <div className="font-display font-black text-2xl" style={{ color: primaryColor }}>
              {name || 'Team Name'}
            </div>
            <div className="font-mono text-sm text-text-muted">{abbreviation || 'ABBR'}</div>
          </div>
        </div>

        <div className="text-xs text-text-muted uppercase tracking-wider mb-2">Preview</div>
        <div
          className="rounded-xl p-4 border"
          style={{
            backgroundColor: `${primaryColor}10`,
            borderColor: `${primaryColor}30`,
          }}
        >
          <div className="flex items-center gap-3">
            <TeamLogo
              logoUrl={logoUrl}
              abbreviation={abbreviation}
              primaryColor={primaryColor}
              secondaryColor={secondaryColor}
              size="md"
            />
            <span className="font-display font-bold" style={{ color: primaryColor }}>
              {name} — {abbreviation}
            </span>
            <span className="ml-auto font-display font-black text-2xl text-text-primary">12</span>
            <span className="text-text-muted text-sm">HR</span>
          </div>
        </div>
      </div>

      {/* Name & Abbreviation */}
      <div className="card p-6 space-y-4">
        <h2 className="font-display font-bold text-xl">Identity</h2>
        <div>
          <label className="text-xs text-text-muted block mb-1.5">Team Name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className="input"
            maxLength={50}
          />
        </div>
        <div>
          <label className="text-xs text-text-muted block mb-1.5">Abbreviation (2-5 letters)</label>
          <input
            value={abbreviation}
            onChange={e => setAbbreviation(e.target.value.toUpperCase())}
            className="input font-mono"
            maxLength={5}
          />
        </div>
      </div>

      {/* Logo Upload */}
      <div className="card p-6 space-y-4">
        <h2 className="font-display font-bold text-xl">Team Logo</h2>
        <div className="flex items-center gap-4">
          <TeamLogo
            logoUrl={logoUrl}
            abbreviation={abbreviation}
            primaryColor={primaryColor}
            secondaryColor={secondaryColor}
            size="xl"
          />
          <div className="space-y-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={handleLogoUpload}
              className="hidden"
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="btn-secondary flex items-center gap-2 text-sm"
            >
              <Camera size={14} />
              {logoUrl ? 'Change Logo' : 'Upload Logo'}
            </button>
            {logoUrl && (
              <button
                onClick={() => setLogoUrl(null)}
                className="text-xs text-accent-red hover:underline flex items-center gap-1"
              >
                <Trash2 size={10} />
                Remove
              </button>
            )}
          </div>
        </div>
        <p className="text-xs text-text-muted">PNG, JPG, or WebP. Max 5MB. Will be resized to 256x256.</p>
      </div>

      {/* Colors */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Palette size={16} className="text-brand" />
          <h2 className="font-display font-bold text-xl">Team Colors</h2>
        </div>

        <div>
          <label className="text-xs text-text-muted block mb-2">Primary Color</label>
          <div className="flex items-center gap-2 flex-wrap">
            {COLOR_PRESETS.map(color => (
              <button
                key={`p-${color}`}
                onClick={() => setPrimaryColor(color)}
                className={`w-8 h-8 rounded-lg border-2 transition-transform ${
                  primaryColor === color ? 'scale-110 border-white' : 'border-transparent hover:scale-105'
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
            <input
              type="color"
              value={primaryColor}
              onChange={e => setPrimaryColor(e.target.value)}
              className="w-8 h-8 rounded-lg cursor-pointer border-0"
              title="Custom color"
            />
          </div>
        </div>

        <div>
          <label className="text-xs text-text-muted block mb-2">Secondary Color</label>
          <div className="flex items-center gap-2 flex-wrap">
            {COLOR_PRESETS.map(color => (
              <button
                key={`s-${color}`}
                onClick={() => setSecondaryColor(color)}
                className={`w-8 h-8 rounded-lg border-2 transition-transform ${
                  secondaryColor === color ? 'scale-110 border-white' : 'border-transparent hover:scale-105'
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
            <input
              type="color"
              value={secondaryColor}
              onChange={e => setSecondaryColor(e.target.value)}
              className="w-8 h-8 rounded-lg cursor-pointer border-0"
              title="Custom color"
            />
          </div>
        </div>
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="btn-brand w-full py-3 text-base flex items-center justify-center gap-2"
      >
        {saving ? (
          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        ) : (
          <Save size={16} />
        )}
        {saving ? 'Saving...' : 'Save Team Settings'}
      </button>
    </div>
  )
}
