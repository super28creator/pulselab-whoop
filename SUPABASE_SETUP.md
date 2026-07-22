# Supabase — PulseLab

Projekt: `zartihkavuijfhxiojzt` (eu-west-1)

## Zrobione automatycznie
- Tabele: `hr_samples`, `day_summaries`, `pulselab_meta`
- RLS włączone + dostęp dla klienta (anon)
- Apka ładuje historię z chmury przy starcie i uploaduje po syncu Whoop

## Bez logowania
Każdy telefon ma własny `owner_key` w localStorage — dane nie mieszają się między urządzeniami.
