import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

export const dynamic = 'force-dynamic' // prevent static build-time evaluation

const RegisterSchema = z.object({
  name: z.string().min(2).max(60),
  email: z.string().email(),
  password: z.string().min(8).max(100),
  teamName: z.string().min(2).max(50),
  teamAbbr: z.string().min(2).max(5).toUpperCase(),
  inviteCode: z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = RegisterSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0].message },
        { status: 400 }
      )
    }

    const { name, email, password, teamName, teamAbbr } = parsed.data

    // Check for existing user
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json(
        { success: false, error: 'An account with this email already exists' },
        { status: 409 }
      )
    }

    // Check if this is the first user (becomes commissioner)
    const userCount = await prisma.user.count()
    const isFirstUser = userCount === 0

    // Get the league (assumes single-league setup)
    let league = await prisma.league.findFirst()
    if (!league) {
      if (!isFirstUser) {
        return NextResponse.json(
          { success: false, error: 'No league exists. Contact your commissioner.' },
          { status: 400 }
        )
      }
      // Create league if commissioner is registering
      league = await prisma.league.create({
        data: {
          name: 'DINGERS League',
          season: new Date().getFullYear(),
          status: 'SETUP',
        },
      })
    }

    // Check team slot availability
    const teamCount = await prisma.team.count({ where: { leagueId: league.id } })
    if (teamCount >= league.maxTeams) {
      return NextResponse.json(
        { success: false, error: 'League is full (12 teams max)' },
        { status: 400 }
      )
    }

    // Check team name uniqueness
    const existingTeam = await prisma.team.findFirst({
      where: { leagueId: league.id, name: teamName },
    })
    if (existingTeam) {
      return NextResponse.json(
        { success: false, error: 'A team with that name already exists' },
        { status: 409 }
      )
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12)

    // Create user + team in transaction
    const { user, team } = await prisma.$transaction(async tx => {
      const user = await tx.user.create({
        data: {
          name,
          email,
          passwordHash,
          role: isFirstUser ? 'COMMISSIONER' : 'OWNER',
        },
      })

      const team = await tx.team.create({
        data: {
          leagueId: league!.id,
          userId: user.id,
          name: teamName,
          abbreviation: teamAbbr,
          waiverPriority: teamCount + 1,
        },
      })

      return { user, team }
    })

    // Create session
    const session = await getSession()
    session.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as 'COMMISSIONER' | 'OWNER',
      teamId: team.id,
      leagueId: league.id,
    }
    await session.save()

    return NextResponse.json({
      success: true,
      data: { userId: user.id, teamId: team.id },
      message: 'Account created successfully',
    })

  } catch (err) {
    console.error('[register]', err)
    return NextResponse.json(
      { success: false, error: 'Registration failed' },
      { status: 500 }
    )
  }
}
