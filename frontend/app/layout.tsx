import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Code Q&A",
  description: "Ask questions about any GitHub repository",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.Node;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if (localStorage.getItem('darkMode') === 'true') {
                document.documentElement.classList.add('dark');
              }
            `,
          }}
        />
      </head>
      <body className="antialiased bg-white dark:bg-gray-900" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
