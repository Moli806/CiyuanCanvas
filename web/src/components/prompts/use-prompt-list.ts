import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { ALL_PROMPTS_OPTION, fetchPrompts } from "@/services/api/prompts";
import { retryPromptLibrary } from "@/services/api/prompt-library";

export const PROMPT_PAGE_SIZE = 20;

export function usePromptList({ keyword, enabled = true }: { keyword: string; enabled?: boolean }) {
    const { i18n } = useTranslation();
    const language = i18n.resolvedLanguage ?? "zh-CN";
    const [filters, setFilters] = useState({ language, category: ALL_PROMPTS_OPTION, tags: [] as string[] });
    const selectedCategory = filters.language === language ? filters.category : ALL_PROMPTS_OPTION;
    const selectedTags = useMemo(() => filters.language === language ? filters.tags : [], [filters, language]);
    const [debouncedKeyword, setDebouncedKeyword] = useState(keyword);
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedKeyword(keyword), 300);
        return () => clearTimeout(timer);
    }, [keyword]);
    const query = useInfiniteQuery({
        queryKey: ["prompts", language, debouncedKeyword, selectedTags, selectedCategory],
        queryFn: ({ pageParam }) => fetchPrompts({ language, keyword: debouncedKeyword, tag: selectedTags, category: selectedCategory, page: pageParam, pageSize: PROMPT_PAGE_SIZE }),
        initialPageParam: 1,
        getNextPageParam: (lastPage, pages) => (pages.reduce((total, page) => total + page.items.length, 0) < lastPage.total ? pages.length + 1 : undefined),
        enabled,
    });
    const firstPage = query.data?.pages[0];
    return {
        query,
        selectedCategory,
        selectedTags,
        setSelectedCategory: (category: string) => setFilters({ language, category, tags: [] }),
        toggleTag: (tag: string) => {
            const tags = tag === ALL_PROMPTS_OPTION ? [] : selectedTags.includes(tag) ? selectedTags.filter((item) => item !== tag) : [...selectedTags, tag];
            setFilters({ language, category: selectedCategory, tags });
        },
        items: useMemo(() => query.data?.pages.flatMap((page) => page.items) || [], [query.data?.pages]),
        tags: useMemo(() => [ALL_PROMPTS_OPTION, ...new Set([...(firstPage?.tags || []), ...selectedTags])], [firstPage?.tags, selectedTags]),
        categories: useMemo(() => [ALL_PROMPTS_OPTION, ...(firstPage?.categories || [])], [firstPage?.categories]),
        total: firstPage?.total || 0,
        incomplete: firstPage?.incomplete ?? false,
        retryLibrary: () => { retryPromptLibrary(); void query.refetch(); },
    };
}
