# Règles de confidentialité de StockInfos

*Dernière mise à jour : 25 novembre 2026*

StockInfos est une application Windows de gestion de stock et de planning. Elle fonctionne sur votre ordinateur, sans compte StockInfos et sans serveur StockInfos.

## Données enregistrées

- Votre stock, vos kits, vos chantiers et vos réglages sont enregistrés **uniquement sur votre ordinateur**, dans le dossier `%APPDATA%\StockInfos`.
- Aucune donnée n'est envoyée à l'auteur de StockInfos ni à un tiers, et l'application ne contient aucun outil de statistiques ou de publicité.

## Google Agenda

Si vous choisissez de connecter votre compte Google :

- La connexion se fait sur la page officielle de Google. StockInfos ne voit jamais votre mot de passe.
- StockInfos demande seulement l'accès `calendar.app.created` : il peut créer un agenda secondaire « Chantiers StockInfos » et gérer les événements **de cet agenda uniquement**. Il ne peut ni lire ni modifier vos autres agendas.
- StockInfos lit aussi votre adresse e-mail, uniquement pour afficher quel compte est connecté.
- Les chantiers créés dans StockInfos (titre, dates, heures, lieu, matériel, notes) sont envoyés directement de votre ordinateur vers Google Agenda.
- L'autorisation donnée par Google est enregistrée sur votre ordinateur, chiffrée par Windows. Elle n'est jamais transmise ailleurs.
- Vous pouvez retirer l'accès à tout moment avec le bouton « Se déconnecter » dans les Paramètres de StockInfos, ou depuis votre compte Google (Sécurité › Applications tierces).

L'utilisation des données reçues des API Google respecte les [Règles concernant les données utilisateur des services d'API Google](https://developers.google.com/terms/api-services-user-data-policy), y compris les exigences d'utilisation limitée.

## Agendas iCal

Si vous ajoutez l'adresse iCal d'un agenda, StockInfos la lit pour afficher vos événements. Cette adresse et ces événements restent sur votre ordinateur.

## Mises à jour

Au démarrage, StockInfos consulte la page publique des versions sur GitHub pour savoir si une mise à jour existe. Aucune donnée personnelle n'est envoyée.

## Contact

Pour toute question : ouvrez un ticket sur https://github.com/Weauz/StockInfos/issues
