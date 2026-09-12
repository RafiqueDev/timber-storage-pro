import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { AlertTriangle, Package } from "lucide-react";
import { api } from "../api/client.js";
import { Button } from "../components/ui.jsx";

export default function PortalAccess() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .portalVerify(token)
      .then((data) => {
        sessionStorage.setItem("tsp_portal_token", data.token);
        sessionStorage.setItem("tsp_portal_party", JSON.stringify(data.party));
        sessionStorage.setItem("tsp_portal_expires", data.expiresAt);
        navigate("/portal/dashboard", { replace: true });
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="dark flex min-h-screen items-center justify-center bg-stone-950 px-4">
      <div className="w-full max-w-sm text-center">
        {!error ? (
          <>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-400 via-primary-600 to-primary-800">
              <Package className="h-7 w-7 text-white" />
            </div>
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
            <p className="text-sm text-stone-400">Verifying your access link...</p>
          </>
        ) : (
          <>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-950/60">
              <AlertTriangle className="h-7 w-7 text-red-400" />
            </div>
            <h1 className="mb-1 text-lg font-bold text-stone-50">This link isn't working</h1>
            <p className="mb-5 text-sm text-stone-400">{error}</p>
            <Link to="/portal/login">
              <Button>Enter Username & Password Instead</Button>
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
