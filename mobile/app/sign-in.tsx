import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import { supabase } from "@/src/auth/supabaseClient";

WebBrowser.maybeCompleteAuthSession();

const REDIRECT_URI = "uiuc-bus://auth/callback";

export default function SignInScreen() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogleSignIn() {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: REDIRECT_URI },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    if (data.url) {
      const result = await WebBrowser.openAuthSessionAsync(data.url, REDIRECT_URI);
      if (result.type === "success" && result.url) {
        // Supabase v2 PKCE flow: exchange the auth code for a session
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(
          result.url
        );
        if (exchangeError) setError(exchangeError.message);
        // onAuthStateChange in useAuth will pick up the new session automatically
      }
    }
    setLoading(false);
  }

  async function handleMagicLink() {
    if (!email.trim()) {
      setError("Enter your email address.");
      return;
    }
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: REDIRECT_URI },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setMagicLinkSent(true);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>UIUC Bustle</Text>
      <Text style={styles.subtitle}>Sign in to track your schedule</Text>

      <TouchableOpacity
        style={styles.googleButton}
        onPress={handleGoogleSignIn}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.googleButtonText}>Continue with Google</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.divider}>or</Text>

      <TextInput
        style={styles.input}
        placeholder="Email address"
        placeholderTextColor="#666"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        editable={!loading}
      />
      <TouchableOpacity
        style={styles.magicButton}
        onPress={handleMagicLink}
        disabled={loading}
      >
        <Text style={styles.magicButtonText}>Send magic link</Text>
      </TouchableOpacity>

      {magicLinkSent && (
        <Text style={styles.successText}>Check your email for a sign-in link.</Text>
      )}
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "#13294B",
  },
  title: {
    fontSize: 32,
    fontFamily: "DMSerifDisplay_400Regular",
    color: "#fff",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    fontFamily: "DMSans_400Regular",
    color: "#ccc",
    marginBottom: 40,
  },
  googleButton: {
    width: "100%",
    backgroundColor: "#E84A27",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
    marginBottom: 16,
  },
  googleButtonText: {
    color: "#fff",
    fontFamily: "DMSans_600SemiBold",
    fontSize: 16,
  },
  divider: { color: "#aaa", marginBottom: 16 },
  input: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#444",
    borderRadius: 8,
    padding: 12,
    color: "#fff",
    fontFamily: "DMSans_400Regular",
    fontSize: 15,
    marginBottom: 12,
  },
  magicButton: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#E84A27",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  magicButtonText: {
    color: "#E84A27",
    fontFamily: "DMSans_600SemiBold",
    fontSize: 16,
  },
  successText: {
    color: "#4CAF50",
    marginTop: 16,
    fontFamily: "DMSans_400Regular",
  },
  errorText: {
    color: "#ff6b6b",
    marginTop: 16,
    fontFamily: "DMSans_400Regular",
    textAlign: "center",
  },
});
