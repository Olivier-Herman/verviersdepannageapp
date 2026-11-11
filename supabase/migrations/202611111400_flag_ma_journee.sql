-- Chantier Fourrière + Facturation (11/11/2026) : menus rangés, page « Ma journée »,
-- nouvel écran Touring à valider. Visible par Olivier seul le temps de son essai :
-- mode 'off' (pas 'superadmin', qui ouvrirait au compte Apple Reviewer) + pilotes
-- Olivier Herman et Mobi. Jona et l'équipe gardent leurs écrans.
INSERT INTO public.feature_flags (key, mode, label, pilot_user_ids)
VALUES ('ma_journee', 'off', 'Ma journée + menus Fourrière/Facturation rangés + Touring à valider (essai Olivier)',
        ARRAY['fd345b74-539b-466b-9b64-19d168f561d4', '29df3445-f452-4ebc-a7bb-c16a8377289b']::uuid[])
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
