import { Redirect } from "expo-router";

export default function SpacesRedirect() {
  return (
    <Redirect
      href={{ pathname: "/(tabs)/garden", params: { view: "space" } }}
    />
  );
}
