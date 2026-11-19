# Soir de match · remontées terrain

Démo Bloom pour la plénière IA du Paris Basketball (24/11/2026). Données fictives.

Construite avec Claude. Le staff signale depuis son téléphone (photo + phrase), Claude trie chaque signalement, l'écran central se met à jour en direct, chaque responsable reçoit ses alertes dans « Mon poste », et Claude rédige le bilan de la soirée.

- `index.html` : l'app (une seule page, routes `#signaler`, `#ecran`, `#poste`, `#bilan`, `#admin`)
- `supabase/schema.sql` : la base (table, règles de sécurité, temps réel, stockage des photos)
- `supabase/functions/soir/index.ts` : la fonction serveur qui appelle Claude (secret `ANTHROPIC_API_KEY`)
