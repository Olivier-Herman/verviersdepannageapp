-- Refonte du Dispatch (11/11/2026, maquette TASSRqcM1hGBU74DuTfjmt, plan 9M8jDp6cwHGDN6hB4CfD9b).
-- Visible par Olivier seul le temps de son essai : mode 'off' + pilotes Olivier Herman
-- et Mobi (comme ma_journee). L'équipe garde le Dispatch actuel.
INSERT INTO public.feature_flags (key, mode, label, pilot_user_ids)
VALUES ('dispatch_v2', 'off', 'Nouveau Dispatch « tour de contrôle » (essai Olivier)',
        ARRAY['fd345b74-539b-466b-9b64-19d168f561d4', '29df3445-f452-4ebc-a7bb-c16a8377289b']::uuid[])
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
