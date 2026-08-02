// Edge Function : génère une URL d'upload signée vers Cloudflare R2.
//
// Le navigateur n'a jamais la clé secrète R2 : il demande une URL temporaire
// ici, puis envoie le fichier directement à R2 avec cette URL.
//
// Déploiement :
//   supabase functions deploy r2-upload-url
//   supabase secrets set R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... \
//     R2_SECRET_ACCESS_KEY=... R2_BUCKET=...

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { S3Client } from 'npm:@aws-sdk/client-s3@3';
import { PutObjectCommand } from 'npm:@aws-sdk/client-s3@3';
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Seuls les utilisateurs connectés peuvent envoyer une vidéo.
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

    // Seuls les administrateurs peuvent envoyer une vidéo. Vérifié ici en
    // plus des règles RLS : sans ce contrôle, n'importe quel compte pourrait
    // obtenir une URL signée et remplir le bucket R2.
    const { data: isAdmin } = await supabase.rpc('is_admin');

    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Réservé aux administrateurs' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { fileName, contentType } = await req.json();

    // Clé unique : évite les collisions entre fichiers du même nom.
    const safeName = String(fileName ?? 'video').replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageKey = `${user.id}/${crypto.randomUUID()}-${safeName}`;

    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${Deno.env.get('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
        secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
      },
    });

    const uploadUrl = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: Deno.env.get('R2_BUCKET')!,
        Key: storageKey,
        ContentType: contentType || 'application/octet-stream',
      }),
      { expiresIn: 3600 },
    );

    return new Response(JSON.stringify({ uploadUrl, storageKey }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
