import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Linking,
} from "react-native";
import * as ExpoLinking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { LinearGradient } from "expo-linear-gradient";
import { Bus } from "lucide-react-native";
import { completeAuthFromUrl } from "@/src/auth/authCallback";
import { supabase } from "@/src/auth/supabaseClient";
import { theme } from "@/src/constants/theme";
import { FadeInView, FloatingView, PressableScale } from "@/src/components/ui/motion";

WebBrowser.maybeCompleteAuthSession();

// In Expo Go this resolves to exp://<host>/--/auth/callback (custom schemes don't
// work there); in a dev/standalone build it resolves to uiuc-bus://auth/callback.
const REDIRECT_URI = ExpoLinking.createURL("auth/callback");

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
        const exchangeError = await completeAuthFromUrl(result.url);
        if (exchangeError) setError(exchangeError);
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
      <LinearGradient
        colors={[theme.gradients.hero[0], theme.gradients.hero[1], theme.gradients.hero[2]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Drifting decorative blobs */}
      <FloatingView distance={12} duration={3400} style={[styles.blob, styles.blobOrange]} />
      <FloatingView distance={16} duration={4200} delay={500} style={[styles.blob, styles.blobSky]} />
      <FloatingView distance={9} duration={2900} delay={900} style={[styles.blob, styles.blobWhite]} />

      <View style={styles.content}>
        <FadeInView delay={0} style={styles.headerBlock}>
          <FloatingView distance={6} duration={3000} style={styles.iconFloat}>
            <View style={styles.iconCircle}>
              <Bus size={32} color={theme.colors.orangeBright} strokeWidth={2.2} />
            </View>
          </FloatingView>
          <Text style={styles.title}>UIUC Bustle</Text>
        </FadeInView>

        <FadeInView delay={80}>
          <Text style={styles.subtitle}>Sign in to track your schedule</Text>
        </FadeInView>

        <FadeInView delay={160}>
          <PressableScale
            onPress={handleGoogleSignIn}
            disabled={loading}
            style={styles.googleButton}
          >
            <LinearGradient
              colors={[theme.gradients.sunset[0], theme.gradients.sunset[1]]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.googleGradient}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.googleButtonText}>Continue with Google</Text>
              )}
            </LinearGradient>
          </PressableScale>
        </FadeInView>

        <FadeInView delay={220} style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.divider}>or</Text>
          <View style={styles.dividerLine} />
        </FadeInView>

        <FadeInView delay={280}>
          <TextInput
            style={styles.input}
            placeholder="Email address"
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            editable={!loading}
          />
          <PressableScale
            onPress={handleMagicLink}
            disabled={loading}
            style={styles.magicButton}
          >
            <Text style={styles.magicButtonText}>Send magic link</Text>
          </PressableScale>
        </FadeInView>

        {magicLinkSent && (
          <Text style={styles.successText}>Check your email for a sign-in link.</Text>
        )}
        {error && <Text style={styles.errorText}>{error}</Text>}
      </View>

      <FadeInView delay={360} style={styles.privacyWrap}>
        <Text style={styles.privacyText}>
          By signing in you agree to our{" "}
          <Text
            style={styles.privacyLink}
            onPress={() => Linking.openURL("https://your-privacy-policy-url.com")}
          >
            Privacy Policy
          </Text>
          .
        </Text>
      </FadeInView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    backgroundColor: theme.colors.navyDeep,
  },
  blob: {
    position: "absolute",
  },
  blobOrange: {
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: "rgba(232,74,39,0.12)",
    top: -70,
    right: -90,
  },
  blobSky: {
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: "rgba(56,189,248,0.08)",
    bottom: 90,
    left: -100,
  },
  blobWhite: {
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: "rgba(255,255,255,0.04)",
    top: "34%",
    right: -50,
  },
  content: {
    width: "100%",
  },
  headerBlock: {
    alignItems: "center",
  },
  iconFloat: {
    marginBottom: 18,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(255,107,61,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,107,61,0.35)",
    alignItems: "center",
    justifyContent: "center",
    ...theme.shadows.glowOrange,
  },
  title: {
    fontSize: 40,
    lineHeight: 48,
    fontFamily: "DMSerifDisplay_400Regular",
    color: "#fff",
    marginBottom: 8,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    fontFamily: "DMSans_400Regular",
    color: theme.colors.textOnNavyMuted,
    marginBottom: 36,
    textAlign: "center",
  },
  googleButton: {
    width: "100%",
    borderRadius: theme.radius.lg,
    ...theme.shadows.glowOrange,
  },
  googleGradient: {
    borderRadius: theme.radius.lg,
    overflow: "hidden",
    padding: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  googleButtonText: {
    color: "#fff",
    fontFamily: "DMSans_700Bold",
    fontSize: 16,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  divider: {
    color: theme.colors.textOnNavyMuted,
    fontFamily: "DMSans_500Medium",
    fontSize: 13,
    marginHorizontal: 12,
  },
  input: {
    width: "100%",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: theme.radius.lg,
    paddingVertical: 14,
    paddingHorizontal: 16,
    color: "#fff",
    fontFamily: "DMSans_400Regular",
    fontSize: 15,
    marginBottom: 12,
  },
  magicButton: {
    width: "100%",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
    borderRadius: theme.radius.lg,
    padding: 14,
    alignItems: "center",
  },
  magicButtonText: {
    color: theme.colors.textOnNavy,
    fontFamily: "DMSans_600SemiBold",
    fontSize: 16,
  },
  successText: {
    color: theme.colors.mint,
    marginTop: 16,
    fontFamily: "DMSans_400Regular",
    textAlign: "center",
  },
  errorText: {
    color: "#FCA5A5",
    marginTop: 16,
    fontFamily: "DMSans_400Regular",
    textAlign: "center",
  },
  privacyWrap: {
    position: "absolute",
    bottom: 36,
    left: 24,
    right: 24,
    alignItems: "center",
  },
  privacyText: {
    color: theme.colors.textOnNavyMuted,
    fontFamily: "DMSans_400Regular",
    fontSize: 12,
    textAlign: "center",
  },
  privacyLink: {
    color: theme.colors.textOnNavy,
    textDecorationLine: "underline",
  },
});
