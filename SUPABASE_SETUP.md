# Supabase setup (PulseLab cloud history)

## One-time in Supabase dashboard

1. **SQL Editor** → wklej i Run cały plik `supabase/schema.sql`
2. **Authentication → Providers → Anonymous** → **Enable**
3. (już zrobione) Data API ON, auto-expose OFF, auto-RLS ON

## Env

Lokalnie: `.env.local` (już utworzony, nie idzie do gita)

Vercel: `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Jak działa

- Start apki → historia z chmury (szybko)
- Połączenie Whoop → tylko nowe z opaski → upload do chmury
