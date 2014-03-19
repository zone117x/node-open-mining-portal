$(function(){


    var hotSwap = function(page, pushSate){
        if (pushSate) history.pushState(null, null, '/' + page);
        $('.selected').removeClass('selected');
        $('a[href="/' + page + '"]').parent().addClass('selected')
        $.get("/api/get_page", {id: page}, function(data){
            $('#page').html(data);
            console.log('swapped to ' + page);
        }, 'html')
    };

    $('.hot-swapper').click(function(event){
        var pageId = $(this).attr('href').slice(1);
        hotSwap(pageId, true);
        event.preventDefault();
        return false;
    });

    window.addEventListener('load', function() {
        setTimeout(function() {
            window.addEventListener("popstate", function(e) {
                hotSwap(location.pathname.slice(1))
            });
        }, 0);
    });

});