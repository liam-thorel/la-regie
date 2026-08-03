// Simule une partie complète de Doublage Party avec plusieurs joueurs en
// parallèle, contre ton vrai projet Supabase (et R2 pour la lecture des
// vidéos). Chaque joueur est un vrai compte authentifié, avec sa propre
// session, exactement comme dans le navigateur : ça exerce les mêmes
// règles RLS et le même stockage que l'appli réelle, sous charge réelle,
// plutôt que de simplement mesurer un débit brut.
//
// Usage : npm install, puis copier .env.example en .env et le remplir,
// puis `npm run run`.

import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

// ---------- Configuration ----------

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
const PLAYER_COUNT = Number(process.env.PLAYER_COUNT ?? 10);
const ROUNDS_COUNT = Number(process.env.ROUNDS_COUNT ?? 3);
const EMAIL_DOMAIN = process.env.TEST_EMAIL_DOMAIN ?? 'stress.olygames.test';
const PASSWORD = process.env.TEST_PASSWORD ?? 'StressTest123!';

// Identifiant unique du run : sépare les comptes/lobbies d'un lancement à
// l'autre, pour pouvoir en relancer plusieurs sans collision.
const RUN_ID = Date.now().toString(36);

// ---------- Mesure des temps ----------

const timings = [];

async function timed(label, fn) {
  const start = performance.now();
  try {
    const result = await fn();
    timings.push({ label, ms: performance.now() - start, ok: true });
    return result;
  } catch (error) {
    timings.push({ label, ms: performance.now() - start, ok: false, error: String(error?.message ?? error) });
    throw error;
  }
}

function report() {
  const groups = new Map();
  for (const t of timings) {
    if (!groups.has(t.label)) groups.set(t.label, []);
    groups.get(t.label).push(t);
  }

  const rows = [];
  for (const [label, entries] of groups) {
    const durations = entries.map((e) => e.ms).sort((a, b) => a - b);
    const errors = entries.filter((e) => !e.ok);
    rows.push({
      étape: label,
      appels: entries.length,
      'moyenne (ms)': Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
      'p95 (ms)': Math.round(durations[Math.floor(durations.length * 0.95)] ?? durations.at(-1)),
      'max (ms)': Math.round(durations.at(-1)),
      erreurs: errors.length,
    });
  }

  console.log('\n=== Rapport de charge ===\n');
  console.table(rows);

  const allErrors = timings.filter((t) => !t.ok);
  if (allErrors.length > 0) {
    console.log(`\n${allErrors.length} erreur(s) rencontrée(s) :\n`);
    for (const e of allErrors.slice(0, 20)) {
      console.log(`  [${e.label}] ${e.error}`);
    }
    if (allErrors.length > 20) console.log(`  ... et ${allErrors.length - 20} autres.`);
  }
}

// ---------- Contenu factice pour les prises audio ----------
// Le contenu n'a pas besoin d'être un vrai fichier audio jouable : ce script
// teste les chemins d'écriture (stockage + base), pas la lecture. La taille
// (200 Ko) se rapproche d'une prise réelle de quelques dizaines de secondes.
function dummyAudio(sizeBytes = 200_000) {
  return randomBytes(sizeBytes);
}

// ---------- Joueurs ----------

async function ensurePlayer(index) {
  const email = `stress-${RUN_ID}-${index}@${EMAIL_DOMAIN}`;
  const pseudo = `Testeur ${index + 1}`;
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { data: signUpData, error: signUpError } = await client.auth.signUp({
    email,
    password: PASSWORD,
  });

  if (signUpError && !signUpError.message.toLowerCase().includes('already registered')) {
    throw new Error(`Inscription ${email} : ${signUpError.message}`);
  }

  if (!signUpData?.session) {
    const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
    if (signInError) throw new Error(`Connexion ${email} : ${signInError.message}`);
  }

  const {
    data: { user },
  } = await client.auth.getUser();

  const { error: profileError } = await client
    .from('profiles')
    .upsert({ id: user.id, pseudo, avatar_url: null }, { onConflict: 'id' });
  if (profileError) throw new Error(`Profil ${email} : ${profileError.message}`);

  // Ouvre les mêmes canaux temps réel que l'appli, pour charger Realtime
  // en plus des écritures REST : dans le vrai jeu, chaque joueur reste
  // abonné tout du long.
  const channels = [];

  return { client, userId: user.id, pseudo, email, channels };
}

function watchLobby(player, lobbyId) {
  player.channels.push(
    player.client
      .channel(`stress-players-${player.email}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `lobby_id=eq.${lobbyId}` }, () => {})
      .subscribe(),
    player.client
      .channel(`stress-phases-${player.email}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dub_phases', filter: `lobby_id=eq.${lobbyId}` }, () => {})
      .subscribe(),
  );
}

async function closeChannels(players) {
  await Promise.all(players.flatMap((p) => p.channels.map((c) => p.client.removeChannel(c))));
}

// ---------- Déroulé de la partie ----------

async function main() {
  console.log(`Simulation : ${PLAYER_COUNT} joueurs, ${ROUNDS_COUNT} manche(s). Run ${RUN_ID}.\n`);

  console.log('Préparation des comptes de test...');
  const players = await Promise.all(
    Array.from({ length: PLAYER_COUNT }, (_, i) => timed('setup-player', () => ensurePlayer(i))),
  );
  const host = players[0];
  console.log(`${players.length} comptes prêts. Host : ${host.email}`);

  const { data: videos, error: videosError } = await host.client
    .from('videos')
    .select('*')
    .order('created_at', { ascending: false });

  if (videosError) throw new Error(`Lecture des vidéos : ${videosError.message}`);
  if (!videos || videos.length < ROUNDS_COUNT) {
    console.error(
      `\nIl faut au moins ${ROUNDS_COUNT} vidéo(s) dans la bibliothèque pour jouer ${ROUNDS_COUNT} manche(s) ` +
        `(trouvé : ${videos?.length ?? 0}). Ajoute des vidéos depuis la page d'administration puis relance.`,
    );
    process.exit(1);
  }
  const chosenVideos = videos.slice(0, ROUNDS_COUNT);

  console.log('\nCréation du lobby...');
  const { data: lobby, error: lobbyError } = await timed('create-lobby', () =>
    host.client
      .from('lobbies')
      .insert({
        host_id: host.userId,
        game_id: 'doublage',
        rounds_count: ROUNDS_COUNT,
        settings: { videoIds: chosenVideos.map((v) => v.id) },
      })
      .select('*')
      .single(),
  );
  if (lobbyError) throw new Error(`Création du lobby : ${lobbyError.message}`);
  console.log(`Lobby créé : code ${lobby.code} (id ${lobby.id})`);

  const { error: roundsError } = await timed('setup-rounds', () =>
    host.client
      .from('lobby_rounds')
      .insert(chosenVideos.map((v, i) => ({ lobby_id: lobby.id, round_number: i + 1, video_id: v.id }))),
  );
  if (roundsError) throw new Error(`Composition des manches : ${roundsError.message}`);

  console.log(`\n${players.length} joueurs rejoignent le lobby...`);
  await Promise.all(
    players.map((p) =>
      timed('join', () =>
        p.client
          .from('players')
          .upsert(
            { lobby_id: lobby.id, profile_id: p.userId, pseudo: p.pseudo, avatar_url: null },
            { onConflict: 'lobby_id,profile_id' },
          ),
      ),
    ),
  );

  players.forEach((p) => watchLobby(p, lobby.id));

  const { data: playerRows, error: playerRowsError } = await host.client
    .from('players')
    .select('*')
    .eq('lobby_id', lobby.id);
  if (playerRowsError) throw new Error(`Lecture des joueurs : ${playerRowsError.message}`);
  const playerByProfile = new Map(playerRows.map((p) => [p.profile_id, p]));

  console.log('\nLancement de la partie...');
  const { error: startError } = await timed('start-game', () =>
    host.client.from('lobbies').update({ status: 'in_game', current_round: 1 }).eq('id', lobby.id),
  );
  if (startError) throw new Error(`Lancement : ${startError.message}`);

  for (let round = 1; round <= ROUNDS_COUNT; round++) {
    console.log(`\n--- Manche ${round}/${ROUNDS_COUNT} ---`);

    await timed('open-recording', () =>
      host.client
        .from('dub_phases')
        .upsert({ lobby_id: lobby.id, phase: 'recording', playback_index: 0 }, { onConflict: 'lobby_id' }),
    );

    console.log('Envoi des prises (upload stockage + écriture base, en parallèle)...');
    await Promise.all(
      players.map((p) =>
        timed('take', async () => {
          const player = playerByProfile.get(p.userId);
          const path = `${lobby.id}/${round}/${p.userId}/prise.webm`;
          const audio = dummyAudio();

          const { error: uploadError } = await p.client.storage
            .from('dubs')
            .upload(path, audio, { contentType: 'audio/webm', upsert: true });
          if (uploadError) throw new Error(`upload ${p.email} : ${uploadError.message}`);

          const { error: insertError } = await p.client.from('dubs').upsert(
            {
              lobby_id: lobby.id,
              round_number: round,
              player_id: player.id,
              audio_storage_path: path,
              is_locked: false,
            },
            { onConflict: 'lobby_id,round_number,player_id' },
          );
          if (insertError) throw new Error(`dub insert ${p.email} : ${insertError.message}`);

          const { error: lockError } = await p.client
            .from('dubs')
            .update({ is_locked: true })
            .eq('lobby_id', lobby.id)
            .eq('round_number', round)
            .eq('player_id', player.id);
          if (lockError) throw new Error(`dub lock ${p.email} : ${lockError.message}`);
        }),
      ),
    );

    console.log('Diffusion puis ouverture du vote...');
    await timed('start-playback', () =>
      host.client.from('dub_phases').update({ phase: 'playback', playback_index: 0 }).eq('lobby_id', lobby.id),
    );
    await timed('open-voting', () =>
      host.client.from('dub_phases').update({ phase: 'voting' }).eq('lobby_id', lobby.id),
    );

    const { data: dubs, error: dubsError } = await host.client
      .from('dubs')
      .select('*')
      .eq('lobby_id', lobby.id)
      .eq('round_number', round);
    if (dubsError) throw new Error(`Lecture des prises : ${dubsError.message}`);

    console.log(`Vote sur ${dubs.length} prise(s), en parallèle...`);
    await Promise.all(
      players.map((p) =>
        timed('votes', async () => {
          const player = playerByProfile.get(p.userId);
          const votable = dubs.filter((d) => d.player_id !== player.id);
          let superLikeUsed = false;

          for (const dub of votable) {
            let value;
            if (!superLikeUsed && Math.random() < 0.15) {
              value = 2;
              superLikeUsed = true;
            } else {
              value = [-1, 0, 1][Math.floor(Math.random() * 3)];
            }

            const { error } = await p.client.from('votes').upsert(
              { lobby_id: lobby.id, round_number: round, dub_id: dub.id, voter_player_id: player.id, value },
              { onConflict: 'dub_id,voter_player_id' },
            );
            if (error) throw new Error(`vote ${p.email} sur ${dub.id} : ${error.message}`);
          }
        }),
      ),
    );

    if (round >= ROUNDS_COUNT) {
      await timed('finish-game', () =>
        host.client.from('lobbies').update({ status: 'finished' }).eq('id', lobby.id),
      );
    } else {
      await timed('end-round', async () => {
        await host.client.from('lobbies').update({ current_round: round + 1 }).eq('id', lobby.id);
        await host.client
          .from('dub_phases')
          .update({ phase: 'recording', playback_index: 0 })
          .eq('lobby_id', lobby.id);
      });
    }
  }

  console.log('\nClassement final :');
  const { data: trophies } = await host.client
    .from('lobby_trophies')
    .select('*')
    .eq('lobby_id', lobby.id)
    .order('score', { ascending: false });

  console.table(
    (trophies ?? []).map((t) => ({
      pseudo: t.pseudo,
      score: t.score,
      '+1 donnés': t.likes_given,
      '-1 donnés': t.dislikes_given,
      'super likes reçus': t.super_likes_received,
    })),
  );

  await closeChannels(players);
  report();

  console.log(`\nPour nettoyer cette partie de test :`);
  console.log(`  node cleanup.mjs ${lobby.id} ${RUN_ID}`);
}

main().catch((error) => {
  console.error('\nÉchec de la simulation :', error.message ?? error);
  report();
  process.exit(1);
});
