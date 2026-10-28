const HOME_URL = `${import.meta.env.BASE_URL}home/index.html`;

export default function IndexPage() {
    return <iframe src={HOME_URL} title="词元画布首页" className="block h-full w-full border-0 bg-[#05090e]" />;
}
