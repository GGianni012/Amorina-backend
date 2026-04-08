ALTER TABLE public.pos_session_guests
ADD COLUMN IF NOT EXISTS guest_token TEXT;

CREATE INDEX IF NOT EXISTS idx_pos_session_guests_guest_token
ON public.pos_session_guests(guest_token);

WITH ranked_active_guests AS (
    SELECT
        id,
        session_id,
        ROW_NUMBER() OVER (
            PARTITION BY session_id
            ORDER BY joined_at ASC, id ASC
        ) AS row_rank
    FROM public.pos_session_guests
    WHERE left_at IS NULL
)
UPDATE public.pos_session_guests guest
SET left_at = NOW()
FROM ranked_active_guests ranked
WHERE guest.id = ranked.id
  AND ranked.row_rank > 1
  AND guest.left_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_session_guests_active_session_unique
ON public.pos_session_guests(session_id)
WHERE left_at IS NULL;

UPDATE public.pos_table_sessions session
SET guest_count = COALESCE(guest_counts.active_guest_count, 0)
FROM (
    SELECT
        session_id,
        COUNT(*) FILTER (WHERE left_at IS NULL) AS active_guest_count
    FROM public.pos_session_guests
    GROUP BY session_id
) AS guest_counts
WHERE guest_counts.session_id = session.id;

UPDATE public.pos_table_sessions session
SET guest_count = 0
WHERE NOT EXISTS (
    SELECT 1
    FROM public.pos_session_guests guest
    WHERE guest.session_id = session.id
      AND guest.left_at IS NULL
);
