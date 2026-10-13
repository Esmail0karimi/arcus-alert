# Arcus Alert

A lightweight desktop companion for monitoring Arcus markets and managing price alerts.

Arcus Alert is an independent, community-built project. It is not an official Arcus product and is not endorsed by Arcus unless explicitly stated by the Arcus team.

## Features

- Live market overview powered by Arcus market data.
- Searchable market and symbol selection.
- Interactive candlestick chart with chart-based alert placement.
- Create, review, edit, and remove price alerts.
- Custom notification sounds.
- Persistent desktop notifications with click-through navigation to the relevant market chart.
- Windows x64 portable application; no installer required.

## Download

Get the latest Windows build from the [GitHub Releases](https://github.com/Esmail0karimi/arcus-alert/releases) page.

1. Download the `Arcus-Alert-Windows-Portable-*.exe` asset.
2. Save it to a folder you control.
3. Run the application. Windows SmartScreen may show a warning because this community build is not currently code-signed. Only run software you trust and verify that you downloaded it from this repository's official Releases page.

The portable build is currently intended for **Windows 10/11, 64-bit**.

## Getting started

1. Launch Arcus Alert.
2. Choose a market from Market, Watchlist, or the searchable chart selector.
3. Open Chart and use the chart's price scale/crosshair control to place an alert.
4. Manage active alerts in the Alerts tab.
5. Configure a notification sound from the app's sound controls.

Keep the application running for desktop price monitoring and notifications. Notification delivery and market-data availability depend on Windows notification settings, network connectivity, and the Arcus API.

## Data source and limitations

- Market data is retrieved from Arcus public API endpoints.
- This project is provided as-is. Market data, API availability, latency, and symbol coverage may change.
- Alerts are a convenience tool, not investment advice or a guarantee of execution price.
- The current Windows distribution is portable x64. Other platforms are not covered by this release.

## Security

Download release binaries only from this repository's [Releases](https://github.com/Esmail0karimi/arcus-alert/releases) page. Please report suspected vulnerabilities privately; see [SECURITY.md](SECURITY.md).

## Contributing and feedback

Bug reports, feature requests, and code contributions are welcome through [GitHub Issues](https://github.com/Esmail0karimi/arcus-alert/issues) and pull requests. Please include your Windows version, app version, steps to reproduce, and relevant screenshots or logs. Never include API secrets, private keys, or other credentials.

## License

Released under the MIT License. See [LICENSE](LICENSE).
