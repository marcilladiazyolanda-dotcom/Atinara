import {
  Frequency,
  UrlAssertionBuilder,
  UrlMonitor
} from "checkly/constructs";

const productionUrl = "https://marcilladiazyolanda-dotcom.github.io/Atinara/";

new UrlMonitor("oraklo-home-availability", {
  name: "Atinara · Portada disponible",
  activated: true,
  frequency: Frequency.EVERY_10M,
  locations: ["eu-central-1"],
  maxResponseTime: 20000,
  request: {
    url: productionUrl,
    ipFamily: "IPv4",
    assertions: [
      UrlAssertionBuilder.statusCode().equals(200)
    ]
  }
});
new UrlMonitor("oraklo-community-availability", {
  name: "Atinara · Comunidad disponible",
  activated: true,
  frequency: Frequency.EVERY_30M,
  locations: ["eu-central-1"],
  maxResponseTime: 20000,
  request: {
    url: `${productionUrl}community.html`,
    ipFamily: "IPv4",
    assertions: [
      UrlAssertionBuilder.statusCode().equals(200)
    ]
  }
});
