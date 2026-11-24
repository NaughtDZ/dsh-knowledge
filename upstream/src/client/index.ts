/**
 * dsh-knowledge client half: registers the knowledge-base manager as a page in
 * the DSH settings menu (the same floating modal geometry as every other
 * settings section), so it never competes with other plugins' sidebar entries.
 * Registered through slots.inject so contributions wait on the real slot
 * declarations and unwind with this plugin's fiber.
 */
import { createElement as h } from 'react'
import { makeT, getLang } from './i18n.ts'
import { KnowledgePanel } from './panel.tsx'

export const name = 'dsh-knowledge'
export const inject = ['slots']

interface SlotsService {
  inject(slot: string, register: () => unknown): void
  register(meta: Record<string, unknown>, component: unknown): unknown
}

interface KnowledgeClientContext {
  effect(callback: () => unknown, label?: string): void
  slots: SlotsService
}

export function apply(ctx: KnowledgeClientContext): void {
  const t = makeT(getLang())
  ctx.effect(() => () => undefined, 'dsh-knowledge: client')

  // The DSH settings floating window (same modal as every settings section).
  // The settings modal owns its own close chrome, so we pass no onClose.
  ctx.slots.inject('settings.section', () => ctx.slots.register(
    { name: 'settings.section', id: 'knowledge', order: 40, label: () => t('title') },
    () => h(KnowledgePanel, { t }),
  ))
}
