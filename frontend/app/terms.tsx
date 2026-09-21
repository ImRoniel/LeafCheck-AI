import { Action, Notice, Screen } from "@/components/screen";
import { useAuth } from "@/context/auth";
import { useRouter } from "expo-router";
export default function Terms() {
  const router = useRouter();
  const auth = useAuth();
  return (
    <Screen title="Terms and limitations">
      <Notice>
        Plant identification and diagnosis are advisory, not guarantees. You
        remain responsible for plant care.
      </Notice>
      <Notice>
        Authenticated scans send images to external identification and analysis
        providers through the API. Do not upload sensitive information. Guest
        mode does not access private cloud plants, telemetry, or scans.
      </Notice>
      <Notice>
        Sensor readings may be missing, delayed, or inaccurate. Light is
        measured in lux; soil pH is not a live measurement. Local device
        mappings are not verified pairing.
      </Notice>
      <Notice>
        Accounts require an email and password. Password recovery, email
        verification, augmented reality, and account deletion are not available.
        Session credentials use native secure storage or secure browser cookies.
      </Notice>
      <Notice>
        Registration acceptance is collected in the registration form. These
        limitations are not a substitute for an operator-reviewed privacy policy
        and production terms.
      </Notice>
      <Action
        label="Return"
        onPress={() => {
          if (router.canGoBack()) router.back();
          else
            router.replace(
              auth.isGuest || auth.status === "authenticated"
                ? "/(tabs)"
                : "/login",
            );
        }}
      />
    </Screen>
  );
}
