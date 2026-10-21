/**
 * Preferências de pedidos de música por streamer.
 *
 * São gravadas como metadata de uma linha de Integration do tipo
 * `music_requests`. Assim não é necessário alterar o schema para guardar
 * configurações que são específicas do fluxo de pedidos musicais.
 */

import prisma from '../lib/prisma'

export type SongRequestAction = 'add_to_queue' | 'play_next' | 'ignore'

export interface SongRequestSettings {
  enabled: boolean
  minAmountCents: number
  action: SongRequestAction
}

const SETTINGS_TYPE = 'music_requests'
const DEFAULTS: SongRequestSettings = {
  enabled: true,
  minAmountCents: 0,
  action: 'add_to_queue',
}

function parseMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function normalizeAction(value: unknown): SongRequestAction {
  return value === 'play_next' || value === 'ignore' || value === 'add_to_queue'
    ? value
    : DEFAULTS.action
}

function normalizeSettings(metadata: Record<string, unknown>): SongRequestSettings {
  const minAmountCents =
    typeof metadata.minAmountCents === 'number' && Number.isFinite(metadata.minAmountCents)
      ? Math.max(0, Math.round(metadata.minAmountCents))
      : DEFAULTS.minAmountCents

  return {
    enabled: typeof metadata.enabled === 'boolean' ? metadata.enabled : DEFAULTS.enabled,
    minAmountCents,
    action: normalizeAction(metadata.action),
  }
}

export async function getSongRequestSettings(userId: string): Promise<SongRequestSettings> {
  const integration = await prisma.integration.findUnique({
    where: { userId_type: { userId, type: SETTINGS_TYPE } },
  })

  return normalizeSettings(parseMetadata(integration?.metadata))
}

export async function saveSongRequestSettings(
  userId: string,
  patch: Partial<SongRequestSettings>
): Promise<SongRequestSettings> {
  const current = await getSongRequestSettings(userId)
  const next = normalizeSettings({
    enabled: patch.enabled ?? current.enabled,
    minAmountCents: patch.minAmountCents ?? current.minAmountCents,
    action: patch.action ?? current.action,
  })

  const metadata = JSON.stringify({
    enabled: next.enabled,
    minAmountCents: next.minAmountCents,
    action: next.action,
  })

  await prisma.integration.upsert({
    where: { userId_type: { userId, type: SETTINGS_TYPE } },
    update: {
      name: 'Pedidos de música',
      isActive: true,
      metadata,
    },
    create: {
      userId,
      type: SETTINGS_TYPE,
      name: 'Pedidos de música',
      isActive: true,
      metadata,
    },
  })

  return next
}
