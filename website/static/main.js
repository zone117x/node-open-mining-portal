$(function(){


    var hotSwap = function(page, pushSate){
        if (pushSate) history.pushState(null, null, '/' + page);
        $('.selected').removeClass('selected');
        $('a[href="/' + page + '"]').parent().addClass('selected')
        $.get("/get_page", {id: page}, function(data){
            $('#page').html(data);
        }, 'html')
    };

    $('.hot-swapper').click(function(event){
        if (event.which !== 1) return;
        var pageId = $(this).attr('href').slice(1);
        hotSwap(pageId, true);
        event.preventDefault();
        return false;
    });

    window.addEventListener('load', function() {
        setTimeout(function() {
            window.addEventListener("popstate", function(e) {
                hotSwap(location.pathname.slice(1));
            });
        }, 0);
    });

    var statsSource = new EventSource("/api/live_stats");
    statsSource.addEventListener('message', function(e){
        var stats = JSON.parse(e.data);
        $('#statsMiners').text(stats.global.workers);
        $('#statsHashrate').text(stats.global.hashrate);
    });

});