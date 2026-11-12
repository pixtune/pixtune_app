'use client'

import React from 'react'
import { AuthProvider } from '@client/contexts/AuthContext'
import { AccessibilityProvider } from '@client/contexts/AccessibilityContext'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AccessibilityProvider>
      <AuthProvider>{children}</AuthProvider>
    </AccessibilityProvider>
  )
}

