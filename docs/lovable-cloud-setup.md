# Setup Lovable Cloud — prompt da incollare nella chat di Lovable

Le tabelle sono derivate da `src/integrations/supabase/types.ts` (schema del progetto originale). Le migrazioni vanno create da Lovable, non a mano.

> Crea nel database (schema `public`) queste tabelle e abilita RLS. Il portale usa il client Supabase dal browser, quindi servono policy che permettano a `anon`/`authenticated` select, insert, update e delete su tutte le tabelle `editorial_*`, e select + insert su `trend_submissions`.
>
> - `editorial_plans`: id uuid pk default gen_random_uuid(), month int not null, year int not null, created_at timestamptz default now(). Unique (year, month).
> - `editorial_posts`: id uuid pk, plan_id uuid not null → editorial_plans(id) on delete cascade, post_date date not null, canali text[] not null default '{}', channel_copies jsonb not null default '{}', copy_visual text, disclaimer text, formato text, obiettivo_media text, budget_media numeric, programmato boolean not null default false, rubrica text, topic text, visual_type text, visual_url text, created_at timestamptz default now().
> - `editorial_post_media`: id uuid pk, post_id uuid not null → editorial_posts(id) on delete cascade, url text not null, type text, position int not null default 0, created_at.
> - `editorial_post_approvals`: id uuid pk, post_id uuid not null → editorial_posts(id) on delete cascade, component text not null, created_at.
> - `editorial_post_comments`: id uuid pk, post_id uuid not null → editorial_posts(id) on delete cascade, component text not null, body text not null, created_at.
> - `editorial_published_posts`: id uuid pk, canale text not null, url text not null, caption text, published_date date not null, matched_post_id uuid → editorial_posts(id) on delete set null, created_at.
> - `editorial_client_channels`: id uuid pk, canale text not null, handle text not null, url text not null, display_name text, bio text, avatar_url text, followers_count text, following_count text, posts_count text, scraped_at timestamptz, created_at.
> - `trend_submissions`: id uuid pk, url text not null, title text, category text, industry text, tags text[], score numeric, section text, raw_email text, submitted_by text, posted_at timestamptz, status enum `trend_submission_status` ('pending','approved','rejected') not null default 'pending', created_at.
> - Storage: bucket pubblico `piano-editoriale` con policy che permette upload e lettura pubblica.
>
> Poi rigenera `src/integrations/supabase/types.ts` e aggiorna `supabase/config.toml` con il nuovo project_id.

Dopo la migrazione servono anche il secret `GITHUB_TOKEN` (permesso contents: write su questo repo, usato dagli hook che scrivono `src/data/trends.json`).
