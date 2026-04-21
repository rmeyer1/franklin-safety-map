(async () => {
  const system = "frkoh";
  const baseUrl = "https://api.openmhz.com";
  const targets = [
    ["talkgroups.json", `${baseUrl}/${system}/talkgroups`],
    ["calls-latest.json", `${baseUrl}/${system}/calls/latest`],
  ];

  for (const [fileName, url] of targets) {
    const response = await fetch(url, {
      credentials: "include",
      headers: {
        Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(`${url} failed with ${response.status}`);
    }

    const payload = await response.json();
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  console.log("OpenMHz capture complete.");
})();
