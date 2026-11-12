'use client'

import { Suspense } from 'react'
import { SettingsPage } from '@client/pages/dashboard/SettingsPage'

export default function Page() {
  return (
    <Suspense fallback={<div className="p-8 text-pixtune-textMuted">Carregando configurações...</div>}>
      <SettingsPage />
    </Suspense>
  )
}

