-- Soir de match · remontées terrain · Paris Basketball (démo Bloom, données fictives)
-- À coller dans Supabase > SQL Editor > New query, puis Run.

create table if not exists public.signalements (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  texte text not null default '',
  zone text,
  role text,
  photo_url text,
  statut text not null default 'nouveau',          -- nouveau | traite
  analyse_ia text not null default 'en_cours',         -- en_cours | ok | echec
  categorie text,                                   -- Incident | Activation partenaire | Idée
  sous_categorie text,
  partenaire text,
  urgence text,                                     -- Urgent | Ce soir | Débrief
  responsable text,
  resume text,
  personne_visible boolean not null default false,
  masque boolean not null default false,              -- texte ou photo déplacés : jamais affichés sur l'écran
  traite_at timestamptz
);

alter table public.signalements enable row level security;

drop policy if exists "lecture" on public.signalements;
create policy "lecture" on public.signalements for select to anon, authenticated using (true);

drop policy if exists "envoi" on public.signalements;
create policy "envoi" on public.signalements for insert to anon, authenticated
  with check (statut = 'nouveau' and analyse_ia = 'en_cours' and categorie is null);

drop policy if exists "traiter" on public.signalements;
create policy "traiter" on public.signalements for update to anon, authenticated
  using (true) with check (statut in ('nouveau', 'traite'));

-- Le public ne peut modifier que le statut (bouton « Traité »). L'IA écrit le reste avec la clé serveur.
-- Les projets Supabase récents n'ouvrent plus les tables au rôle public par défaut.
grant usage on schema public to anon, authenticated;
grant select, insert on public.signalements to anon, authenticated;
revoke update, delete on public.signalements from anon, authenticated;
grant update (statut, traite_at) on public.signalements to anon, authenticated;
grant all on public.signalements to service_role;

-- Temps réel pour l'écran central et « Mon poste »
do $$ begin
  alter publication supabase_realtime add table public.signalements;
exception when duplicate_object then null; end $$;

-- Photos : seau public, 5 Mo maximum, images uniquement
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "depot photos" on storage.objects;
create policy "depot photos" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'photos');
