import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { authMiddleware, getUserId } from '../middleware/auth.js'
import prisma from '../lib/prisma.js'

const rules = new Hono()

// Listar regras do usuário
rules.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const userRules = await prisma.donationRule.findMany({
    where: { userId },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
  })

  return c.json({
    success: true,
    data: {
      rules: userRules.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        minAmount: r.minAmount,
        maxAmount: r.maxAmount,
        keywords: typeof r.keywords === 'string' ? JSON.parse(r.keywords || '[]') : [],
        action: r.action,
        actionData: typeof r.actionData === 'string' ? JSON.parse(r.actionData || '{}') : (r.actionData || {}),
        cooldownMs: r.cooldownMs,
        maxPerHour: r.maxPerHour,
        isActive: r.isActive,
        priority: r.priority,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
      total: userRules.length,
    },
  })
})

// Criar regra
const createRuleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  minAmount: z.number().min(0).default(100),
  maxAmount: z.number().min(0).optional(),
  keywords: z.array(z.string()).default([]),
  action: z.enum(['add_to_queue', 'play_next', 'skip', 'pause', 'resume', 'volume_up', 'volume_down', 'shuffle']),
  actionData: z.record(z.unknown()).default({}),
  cooldownMs: z.number().min(0).default(30000),
  maxPerHour: z.number().min(0).default(10),
  isActive: z.boolean().default(true),
  priority: z.number().default(0),
})

rules.post('/', authMiddleware, zValidator('json', createRuleSchema), async (c) => {
  const userId = getUserId(c)
  const data = c.req.valid('json')

  const rule = await prisma.donationRule.create({
    data: {
      userId,
      name: data.name,
      description: data.description,
      minAmount: data.minAmount,
      maxAmount: data.maxAmount,
      keywords: JSON.stringify(data.keywords),
      action: data.action,
      actionData: JSON.stringify(data.actionData),
      cooldownMs: data.cooldownMs,
      maxPerHour: data.maxPerHour,
      isActive: data.isActive,
      priority: data.priority,
    },
  })

  return c.json(
    { success: true, data: { id: rule.id, name: rule.name, action: rule.action } },
    201
  )
})

// Atualizar regra
const updateRuleSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  minAmount: z.number().min(0).optional(),
  maxAmount: z.number().min(0).optional(),
  keywords: z.array(z.string()).optional(),
  action: z.enum(['add_to_queue', 'play_next', 'skip', 'pause', 'resume', 'volume_up', 'volume_down', 'shuffle']).optional(),
  actionData: z.record(z.unknown()).optional(),
  cooldownMs: z.number().min(0).optional(),
  maxPerHour: z.number().min(0).optional(),
  isActive: z.boolean().optional(),
  priority: z.number().optional(),
})

rules.patch('/:id', authMiddleware, zValidator('json', updateRuleSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const data = c.req.valid('json')

  const rule = await prisma.donationRule.findFirst({ where: { id, userId } })
  if (!rule) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Regra não encontrada' } },
      404
    )
  }

  const updateData: any = {}
  if (data.name !== undefined) updateData.name = data.name
  if (data.description !== undefined) updateData.description = data.description
  if (data.minAmount !== undefined) updateData.minAmount = data.minAmount
  if (data.maxAmount !== undefined) updateData.maxAmount = data.maxAmount
  if (data.keywords !== undefined) updateData.keywords = JSON.stringify(data.keywords)
  if (data.action !== undefined) updateData.action = data.action
  if (data.actionData !== undefined) updateData.actionData = JSON.stringify(data.actionData)
  if (data.cooldownMs !== undefined) updateData.cooldownMs = data.cooldownMs
  if (data.maxPerHour !== undefined) updateData.maxPerHour = data.maxPerHour
  if (data.isActive !== undefined) updateData.isActive = data.isActive
  if (data.priority !== undefined) updateData.priority = data.priority

  const updated = await prisma.donationRule.update({
    where: { id },
    data: updateData,
  })

  return c.json({ success: true, data: { id: updated.id } })
})

// Excluir regra
rules.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const rule = await prisma.donationRule.findFirst({ where: { id, userId } })
  if (!rule) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Regra não encontrada' } },
      404
    )
  }

  await prisma.donationRule.delete({ where: { id } })
  return c.json({ success: true, data: { deleted: id } })
})

// Alternar ativa/inativa
rules.patch('/:id/toggle', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const rule = await prisma.donationRule.findFirst({ where: { id, userId } })
  if (!rule) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Regra não encontrada' } },
      404
    )
  }

  const updated = await prisma.donationRule.update({
    where: { id },
    data: { isActive: !rule.isActive },
  })

  return c.json({ success: true, data: { id: updated.id, isActive: updated.isActive } })
})

export default rules
