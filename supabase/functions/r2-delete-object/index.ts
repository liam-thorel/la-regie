// Edge Function : supprime un objet vidéo sur Cloudflare R2.
//
// Sans elle, supprimer une vidéo dans l'appli ne retirerait que sa fiche
// en base : le fichier resterait sur R2 et continuerait d'occuper le quota.
//
// Déploiement :
//   supabase functions deploy r2-delete-object
// (elle réutilise les secrets déjà posés pour r2-upload-url)

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { DeleteObjectCommand, S3Client } from 'npm:@aws-sdk/client-s3@3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return new Response(JSON.stringify({ error: 'Non autorisé' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Même verrou que pour l'envoi : réservé aux administrateurs.
    const { data: isAdmin } = await supabase.rpc('is_admin');

    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Réservé aux administrateurs' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { storageKey } = await req.json();

    if (!storageKey) {
      return new Response(JSON.stringify({ error: 'Clé manquante' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${Deno.env.get('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
        secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
      },
    });

    await client.send(
      new DeleteObjectCommand({
        Bucket: Deno.env.get('R2_BUCKET')!,
        Key: storageKey,
      }),
    );

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
