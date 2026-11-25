'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { Alert, Button, TextField } from '@/components/ui'

type PayloadError = {
  errors?: Array<{ message?: string; data?: { errors?: Array<{ message?: string }> } }>
}

const errorMessage = async (res: Response, fallback: string): Promise<string> => {
  const body = (await res.json().catch(() => ({}))) as PayloadError
  const first = body.errors?.[0]
  return first?.data?.errors?.[0]?.message ?? first?.message ?? fallback
}

const login = (email: string, password: string) =>
  fetch('/api/users/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

export const LoginForm = ({ next }: { next: string }) => {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setPending(true)
    setError(null)
    const form = new FormData(e.currentTarget)
    const res = await login(String(form.get('email')), String(form.get('password')))
    if (!res.ok) {
      setError(
        res.status === 401
          ? 'That email and password don’t match an account.'
          : await errorMessage(res, 'Sign-in failed.'),
      )
      setPending(false)
      return
    }
    router.push(next)
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate={false}>
      <TextField id="email" label="Email" type="email" autoComplete="email" required />
      <TextField
        id="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
      />
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
      <p className="text-center text-ink-soft">
        New here?{' '}
        <Link
          href={`/register?next=${encodeURIComponent(next)}`}
          className="font-semibold text-clay hover:underline"
        >
          Create an account
        </Link>
      </p>
    </form>
  )
}

export const RegisterForm = ({ next }: { next: string }) => {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setPending(true)
    setError(null)
    const form = new FormData(e.currentTarget)
    const email = String(form.get('email'))
    const password = String(form.get('password'))
    const res = await fetch('/api/users', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.get('name'), email, password }),
    })
    if (!res.ok) {
      setError(await errorMessage(res, 'We couldn’t create your account.'))
      setPending(false)
      return
    }
    const loggedIn = await login(email, password)
    if (!loggedIn.ok) {
      router.push('/login')
      return
    }
    router.push(next)
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <TextField id="name" label="Your name" autoComplete="name" required />
      <TextField id="email" label="Email" type="email" autoComplete="email" required />
      <TextField
        id="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        hint="At least 8 characters."
        required
      />
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Creating account…' : 'Create account'}
      </Button>
      <p className="text-center text-ink-soft">
        Already a member?{' '}
        <Link
          href={`/login?next=${encodeURIComponent(next)}`}
          className="font-semibold text-clay hover:underline"
        >
          Sign in
        </Link>
      </p>
    </form>
  )
}
