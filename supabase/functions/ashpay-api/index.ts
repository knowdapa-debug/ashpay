import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authorization = req.headers.get("Authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return json(
      { error: "Authorization diperlukan" },
      401
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseKey) {
    return json(
      { error: "Konfigurasi server tidak lengkap" },
      500
    );
  }

  const supabase = createClient(
    supabaseUrl,
    supabaseKey,
    {
      global: {
        headers: {
          Authorization: authorization,
        },
      },
    }
  );

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return json(
      { error: "Session tidak valid atau sudah kedaluwarsa" },
      401
    );
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "me";

  // =========================
  // PROFIL + SALDO
  // =========================
  if (action === "me") {
    const [profile, wallet] = await Promise.all([
      supabase
        .from("profiles")
        .select(
          "id,full_name,email,ashpay_id,phone,avatar_url,status,created_at"
        )
        .eq("id", user.id)
        .single(),

      supabase
        .from("wallets")
        .select(
          "id,user_id,balance,currency,updated_at"
        )
        .eq("user_id", user.id)
        .single(),
    ]);

    if (profile.error || wallet.error) {
      return json(
        { error: "Gagal mengambil data akun" },
        500
      );
    }

    return json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
      },
      profile: profile.data,
      wallet: wallet.data,
    });
  }

  // =========================
  // RIWAYAT TRANSAKSI
  // =========================
  if (action === "transactions") {
    const limitValue = Number(
      url.searchParams.get("limit") || "20"
    );

    const limit = Math.min(
      Math.max(
        Number.isFinite(limitValue)
          ? Math.floor(limitValue)
          : 20,
        1
      ),
      50
    );

    const { data, error } = await supabase
      .from("transactions")
      .select(
        "id,type,amount,description,status,reference,counterparty_user_id,created_at"
      )
      .eq("user_id", user.id)
      .order("created_at", {
        ascending: false,
      })
      .limit(limit);

    if (error) {
      return json(
        { error: "Gagal mengambil transaksi" },
        500
      );
    }

    return json({
      success: true,
      transactions: data || [],
    });
  }

  // =========================
  // NOTIFIKASI
  // =========================
  if (action === "notifications") {
    const { data, error } = await supabase
      .from("notifications")
      .select(
        "id,title,message,is_read,created_at"
      )
      .eq("user_id", user.id)
      .order("created_at", {
        ascending: false,
      })
      .limit(50);

    if (error) {
      return json(
        { error: "Gagal mengambil notifikasi" },
        500
      );
    }

    return json({
      success: true,
      notifications: data || [],
    });
  }

  return json(
    {
      error: "Action tidak dikenal",
    },
    400
  );
});
