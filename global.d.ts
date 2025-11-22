declare module 'html2pdf.js' {
  type Options = {
    margin?: number | [number, number] | [number, number, number, number];
    filename?: string;
    image?: { type?: string; quality?: number };
    html2canvas?: { scale?: number };
    jsPDF?: { unit?: string; format?: string | [number, number]; orientation?: string };
  };
  type Instance = { save: () => void };
  export default function html2pdf(element: HTMLElement, options?: Options): Instance;
}