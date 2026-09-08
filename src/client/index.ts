/**
 * dsh-knowledge client half: registers the sidebar footer action (opens the
 * panel drawer) and the Settings section page. Registered through slots.inject
 * so contributions wait on the real slot declarations and unwind with this
 * plugin's fiber.
 */
import { createElement as h, useState } from 'react'
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

const PANEL_STYLE: Record<string, string | number> = {
  position: 'fixed',
  inset: '0 0 0 auto',
  width: 'min(920px, 92vw)',
  zIndex: 200,
  boxShadow: '0 0 40px rgba(0,0,0,.5)',
}

/** A trigger in the sidebar foot that opens the knowledge panel drawer. */
function KnowledgeFooterAction({ wide }: { wide: boolean }): JSX.Element {
  const t = makeT(getLang())
  const [open, setOpen] = useState(false)
  return h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center' } },
    h('button', {
      title: t('title'),
      onClick: () => setOpen(o => !o),
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        width: wide ? '100%' : 36,
        height: 32,
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border, #444)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary, #ddd)',
        cursor: 'pointer',
      },
    },
      h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
        h('path', { d: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13z' }),
        h('path', { d: 'M9 9h6M9 13h6' }),
      ),
      wide ? h('span', {}, t('title')) : null,
    ),
    open ? h('div', {
      style: PANEL_STYLE,
      onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
    }, h(KnowledgePanel, { t, onClose: () => setOpen(false) })) : null,
  )
}

export function apply(ctx: KnowledgeClientContext): void {
  const t = makeT(getLang())
  ctx.effect(() => () => undefined, 'dsh-knowledge: client')

  // Sidebar footer entry → opens the panel drawer.
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
    { name: 'sidebar.footer.action', id: 'knowledge-panel', order: 50, label: () => t('title') },
    (props: unknown) => h(KnowledgeFooterAction, { wide: ((props ?? {}) as { wide?: boolean }).wide === true }),
  ))

  // Settings section page → the same panel in the Settings modal.
  ctx.slots.inject('settings.section', () => ctx.slots.register(
    { name: 'settings.section', id: 'knowledge', order: 40, label: () => t('title') },
    (props: unknown) => h(KnowledgePanel, { t, onClose: ((props ?? {}) as { close?: () => void }).close }),
  ))
}
