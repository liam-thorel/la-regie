// Nettoie une partie de test créée par run.mjs : fichiers audio sur le
// stockage, puis la ligne du lobby (le reste part en cascade : joueurs,
// manches, prises, votes, phases).
//
// Usage : node cleanup.mjs <lobby_id>
//
// Optionnel : si SUPABASE_SERVICE_ROLE_KEY est renseignée dans .env, les
// comptes de test créés par ce run (stress-<run_id>-*@...) sont aussi
// supprimés. Sans cette clé, seule la partie est nettoyée ; les comptes
// de test restent (sans conséquence, ils ne coûtent rien).

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv(new URL('.env', import.meta.url).pathname);

function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.includes('VOTRE-PROJET') || value.includes('VOTRE_CLE')) {
    console.error(`Variable manquante ou non renseignée : ${name} (voir .env.example)`);
    process.exit(1);
  }
  return value;
}

const SUPABASE_URL = requireEnv('SUPABASE_URL');
const SUPABASE_ANON_KEY = requireEnv('SUPABASE_ANON_KEY');
const PASSWORD = process.env.TEST_PASSWORD ?? 'StressTest123!';

const lobbyId = process.argv[2];
if (!lobbyId) {
  console.error('Usage : node cleanup.mjs <lobby_id>');
  process.exit(1);
}

async function main() {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Le host doit être connecté pour supprimer sa propre partie (RLS).
  // Comme ce script ne connaît pas quel compte était l'host, on tente de
  // retrouver son email à partir de host_id, puis on demande le mot de
  // passe de test déjà présent dans .env (même mot de passe pour tous les
  // comptes générés par run.mjs).
  const { data: lobby, error: lobbyError } = await client.from('lobbies').select('*').eq('id', lobbyId).maybeSingle();

  if (lobbyError) {
    console.error('Lecture du lobby impossible :', lobbyError.message);
    process.exit(1);
  }
  if (!lobby) {
    console.log('Ce lobby est déjà introuvable (probablement déjà nettoyé).');
    return;
  }

  // Retrouve l'email de l'host via son profil (les emails ne sont pas
  // publics ; on ne peut pas les lire directement sans clé service_role).
  // On se contente donc de demander à l'appelant de relancer ce script en
  // étant l'host, via les identifiants du run affichés par run.mjs — dans
  // la pratique, on réutilise ici l'email déduit du même schéma
  // stress-<run_id>-0@... si le RUN_ID est passé en 2e argument.
  const runId = process.argv[3];
  if (!runId) {
    console.error(
      "Ajoute l'identifiant de run (affiché par run.mjs, ex: 'lz3k9f') : " +
        `node cleanup.mjs ${lobbyId} <run_id>`,
    );
    process.exit(1);
  }

  const domain = process.env.TEST_EMAIL_DOMAIN ?? 'stress.olygames.test';
  const hostEmail = `stress-${runId}-0@${domain}`;

  const { error: signInError } = await client.auth.signInWithPassword({ email: hostEmail, password: PASSWORD });
  if (signInError) {
    console.error(`Connexion en tant qu'host (${hostEmail}) impossible :`, signInError.message);
    process.exit(1);
  }

  console.log('Suppression des fichiers audio...');
  const paths = [];
  const { data: rounds } = await client.storage.from('dubs').list(lobbyId);
  for (const round of rounds ?? []) {
    const { data: playerDirs } = await client.storage.from('dubs').list(`${lobbyId}/${round.name}`);
    for (const dir of playerDirs ?? []) {
      const { data: files } = await client.storage.from('dubs').list(`${lobbyId}/${round.name}/${dir.name}`);
      for (const file of files ?? []) {
        paths.push(`${lobbyId}/${round.name}/${dir.name}/${file.name}`);
      }
    }
  }
  if (paths.length > 0) {
    await client.storage.from('dubs').remove(paths);
    console.log(`  ${paths.length} fichier(s) supprimé(s).`);
  }

  console.log('Suppression du lobby (joueurs, manches, prises, votes en cascade)...');
  const { error: deleteError } = await client.rpc('delete_lobby', { target_lobby: lobbyId });
  if (deleteError) {
    console.error('Suppression impossible :', deleteError.message);
    process.exit(1);
  }
  console.log('Partie de test supprimée.');

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceRoleKey) {
    console.log('\nSuppression des comptes de test (clé service_role détectée)...');
    const admin = createClient(SUPABASE_URL, serviceRoleKey);
    const playerCount = Number(process.env.PLAYER_COUNT ?? 10);

    for (let i = 0; i < playerCount; i++) {
      const email = `stress-${runId}-${i}@${domain}`;
      const { data: users } = await admin.auth.admin.listUsers();
      const match = users?.users.find((u) => u.email === email);
      if (match) {
        await admin.auth.admin.deleteUser(match.id);
        console.log(`  Compte supprimé : ${email}`);
      }
    }
  } else {
    console.log(
      '\nComptes de test conservés (pas de SUPABASE_SERVICE_ROLE_KEY dans .env). ' +
        'Sans conséquence : ils ne coûtent rien et ne sont visibles de personne.',
    );
  }
}

main();
