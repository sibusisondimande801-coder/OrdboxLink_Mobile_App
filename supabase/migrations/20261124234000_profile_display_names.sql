ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS display_name text NOT NULL DEFAULT ''
  CHECK (char_length(display_name) <= 48);
