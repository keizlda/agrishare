// A one-time message handed from a form to the screen it returns to (the
// Validation tab shows it as a toast after a submission). Read once.
let pending = null;

export function setFlash(message, tone = "success") {
  pending = { message, tone, at: Date.now() };
}

export function takeFlash() {
  const f = pending;
  pending = null;
  return f;
}

// After a proof of planting or harvest report is sent: close the form and
// show the Validation tab (wherever the form was opened from).
export function backToValidation(navigation) {
  if (navigation.canGoBack()) navigation.goBack();
  navigation.navigate("MainTabs", { screen: "Validation" });
}
